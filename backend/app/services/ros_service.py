import multiprocessing
import threading
import asyncio
import janus
import os
import time
from typing import Optional

import roslibpy

__host__ = os.getenv("ROSBRIDGE_HOST", "localhost")


def _ros_process_main(
    host: str,
    port: int,
    subscriptions: dict,
    control_queue: multiprocessing.Queue,
    out_queue: multiprocessing.Queue,
):
    """
    Child process main:
    - runs the roslibpy Ros reactor in the child process main thread (so Twisted can install signals)
    - spawns a control thread that listens for subscribe/unsubscribe/exit commands from main via control_queue
    - spawns a status thread that watches ros.is_connected and forwards status changes via out_queue
    - when messages arrive, forwards ("msg", topic, message) via out_queue
    """
    ros = roslibpy.Ros(host=host, port=port)
    topics = {}
    try:

        def make_cb(tname):
            def _cb(message):
                try:
                    out_queue.put(("msg", tname, message))
                except Exception:
                    pass

            return _cb

        # create initial subscriptions snapshot in main thread before reactor run
        for tname, mtype in (subscriptions or {}).items():
            try:
                topic = roslibpy.Topic(ros, tname, mtype, reconnect_on_close=True)
                topic.subscribe(make_cb(tname))
                topics[tname] = topic
            except Exception as e:
                print(f"⚠️ child subscribe initial {tname}: {e}")

        # control thread: blocks on control_queue.get() and handles commands
        def control_loop():
            while True:
                try:
                    cmd = control_queue.get()
                except Exception:
                    break
                if cmd is None:
                    break
                try:
                    action = cmd[0]
                    if action == "exit":
                        break
                    if action == "subscribe":
                        _, tname, mtype = cmd
                        if tname in topics:
                            continue
                        try:
                            topic = roslibpy.Topic(
                                ros, tname, mtype, reconnect_on_close=True
                            )
                            topic.subscribe(make_cb(tname))
                            topics[tname] = topic
                            out_queue.put(("control_ack", "subscribed", tname))
                        except Exception as e:
                            out_queue.put(("control_err", "subscribe", tname, str(e)))
                    elif action == "unsubscribe":
                        _, tname = cmd
                        if tname in topics:
                            try:
                                topics[tname].unsubscribe()
                            except Exception:
                                pass
                            del topics[tname]
                            out_queue.put(("control_ack", "unsubscribed", tname))
                    elif action == "list":
                        out_queue.put(("control_reply", "list", list(topics.keys())))
                except Exception:
                    pass

        # status thread: watch ros.is_connected and forward changes
        def status_loop():
            prev = None
            while True:
                try:
                    if not ros:
                        break
                    connected = bool(getattr(ros, "is_connected", False))
                    if connected != prev:
                        prev = connected
                        try:
                            out_queue.put(("status", "connected", connected))
                        except Exception:
                            pass
                    time.sleep(0.5)
                except Exception:
                    break

        ctrl_thread = threading.Thread(target=control_loop, daemon=True)
        ctrl_thread.start()
        status_thread = threading.Thread(target=status_loop, daemon=True)
        status_thread.start()

        # run reactor in this process' main thread (allowed to install signals)
        try:
            ros.run_forever()
        except Exception as e:
            print("❌ ROS process run_forever ended:", e)
    except Exception as exc:
        print("❌ ROS child process error:", exc)
    finally:
        # cleanup
        try:
            for t in list(topics.values()):
                try:
                    t.unsubscribe()
                except Exception:
                    pass
        except Exception:
            pass
        try:
            ros.terminate()
        except Exception:
            pass


class RosManager:
    """
    Process-backed Ros manager.
    - start_ros_process() launches a child process that holds the Ros client + topics.
    - dynamic subscribe/unsubscribe is supported via a control_queue IPC.
    - connection status is forwarded from child and exposed via .is_connected.
    - messages from child are forwarded into janus queue in the main process.
    """

    def __init__(self, port: int = 9090):
        self.host = __host__
        self.port = port

        # Local bookkeeping (main process)
        self.desired_subscriptions: dict[str, str] = {}
        self.queue: Optional[janus.Queue] = None

        # Child process handles
        self._ros_proc: Optional[multiprocessing.Process] = None
        self._proc_control_queue: Optional[multiprocessing.Queue] = None
        self._proc_out_queue: Optional[multiprocessing.Queue] = None
        self._proc_forward_task: Optional[asyncio.Task] = None

        # state forwarded from child
        self._child_connected: bool = False

    @property
    def is_connected(self) -> bool:
        """Return connection state as reported by the child process."""
        return self._child_connected

    def start_ros_process(self):
        """Start child process and forward its messages into janus queue."""
        if getattr(self, "_ros_proc", None) and self._ros_proc.is_alive():
            return

        self._proc_control_queue = multiprocessing.Queue()
        self._proc_out_queue = multiprocessing.Queue()

        subs_snapshot = dict(self.desired_subscriptions)

        self._ros_proc = multiprocessing.Process(
            target=_ros_process_main,
            args=(
                self.host,
                self.port,
                subs_snapshot,
                self._proc_control_queue,
                self._proc_out_queue,
            ),
            daemon=True,
        )
        self._ros_proc.start()

        # start asyncio forwarder that moves messages from proc_out_queue -> janus queue
        # ensure forwarder sees a stable local reference to the queue
        self._proc_forward_task = asyncio.create_task(self._proc_queue_forwarder())

    async def _proc_queue_forwarder(self):
        """Async task that moves items from multiprocessing.Queue into the janus queue (and updates state)."""
        loop = asyncio.get_running_loop()
        # capture local reference to avoid None checks on self in loop
        out_q = self._proc_out_queue
        if out_q is None:
            # nothing to forward
            return

        try:
            while True:
                # blocking get in threadpool using the concrete out_q
                try:
                    item = await loop.run_in_executor(None, out_q.get)
                except asyncio.CancelledError:
                    break
                except Exception:
                    # if get fails for some reason, stop forwarder
                    break

                if item is None:
                    break
                try:
                    kind = item[0]
                    if kind == "msg":
                        _, topic, message = item
                        if self.queue is not None:
                            try:
                                self.queue.sync_q.put_nowait(("ros", topic, message))
                            except Exception:
                                pass
                    elif kind == "status":
                        _, key, val = item
                        if key == "connected":
                            self._child_connected = bool(val)
                            print(f"🔁 child connected={self._child_connected}")
                    elif kind == "control_ack":
                        # optional: print acknowledgements
                        _, action, tname = item
                        print(f"🔔 child ack {action} {tname}")
                    elif kind == "control_err":
                        _, action, tname, err = item
                        print(f"⚠️ child control err {action} {tname}: {err}")
                    elif kind == "control_reply":
                        # ignore or handle
                        pass
                except Exception:
                    pass
        finally:
            # best-effort: avoid leaving dangling references
            return

    def stop_ros_process(self):
        """Stop child process and forwarder task."""
        try:
            if getattr(self, "_proc_control_queue", None):
                try:
                    # ask child to exit cleanly
                    self._proc_control_queue.put_nowait(("exit",))
                except Exception:
                    pass
            if getattr(self, "_proc_out_queue", None):
                try:
                    # wake forwarder so it can exit
                    self._proc_out_queue.put_nowait(None)
                except Exception:
                    pass
            if getattr(self, "_ros_proc", None):
                self._ros_proc.terminate()
                self._ros_proc.join(timeout=2.0)
        finally:
            if getattr(self, "_proc_forward_task", None):
                self._proc_forward_task.cancel()

    def subscribe(self, topic_name: str, message_type: str) -> bool:
        """
        Request a subscription. If child process is running, send control message.
        Otherwise record desired_subscriptions so the child will create topics at start.
        """
        if topic_name in self.desired_subscriptions:
            return False
        self.desired_subscriptions[topic_name] = message_type
        if (
            getattr(self, "_proc_control_queue", None)
            and getattr(self, "_ros_proc", None)
            and self._ros_proc.is_alive()
        ):
            try:
                self._proc_control_queue.put_nowait(
                    ("subscribe", topic_name, message_type)
                )
            except Exception:
                pass
        else:
            print(f"⚠️ Queued subscription to {topic_name} (process not running yet)")
        return True

    def unsubscribe(self, topic_name: str) -> bool:
        """Request unsubscribe in child and remove desired_subscriptions."""
        if topic_name not in self.desired_subscriptions:
            return False
        del self.desired_subscriptions[topic_name]
        if (
            getattr(self, "_proc_control_queue", None)
            and getattr(self, "_ros_proc", None)
            and self._ros_proc.is_alive()
        ):
            try:
                self._proc_control_queue.put_nowait(("unsubscribe", topic_name))
            except Exception:
                pass
        return True

    def terminate(self):
        """Shutdown helper for app exit."""
        self.stop_ros_process()


ros_manager = RosManager()
