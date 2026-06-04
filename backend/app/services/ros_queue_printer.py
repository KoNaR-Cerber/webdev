import asyncio
import time
import traceback
import janus
from typing import Any, Optional


async def janus_queue_printer(queue: janus.Queue, name: str = "janus_printer", drain_on_cancel: bool = True) -> None:
    """
    Async consumer for a janus.Queue that prints items (simulates a DB write).
    - Expects producers to use queue.sync_q.put_nowait(...) to push items.
    - The consumer uses queue.async_q to receive items in asyncio.
    - If a None sentinel is put on the queue, the consumer will stop.
    - On cancellation, it will optionally drain remaining items (best-effort).
    Usage:
        task = asyncio.create_task(janus_queue_printer(queue))
        ...
        task.cancel()
    """
    if queue is None:
        raise ValueError("queue must be a janus.Queue")

    print(f"🔁 {name} started")
    try:
        while True:
            try:
                item: Optional[Any] = await queue.async_q.get()
            except asyncio.CancelledError:
                # allow outer finally to run cleanup
                raise

            # sentinel to stop gracefully
            if item is None:
                break

            # expected message shape: ("ros", topic_name, message) but we print generically
            try:
                if isinstance(item, tuple) and len(item) >= 3:
                    tag, topic, message = item[0], item[1], item[2]
                    ts = time.time()
                    print(f"[{name}] {ts:.3f} {tag} {topic}: {message}")
                else:
                    ts = time.time()
                    print(f"[{name}] {ts:.3f} item:", item)
                # simulate async DB write latency if you want:
                # await asyncio.sleep(0.001)
            except Exception:
                print(f"[{name}] error handling item:")
                traceback.print_exc()
            finally:
                # mark task done if supported
                try:
                    queue.async_q.task_done()
                except Exception:
                    pass
    except asyncio.CancelledError:
        # fall through to cleanup
        pass
    finally:
        if drain_on_cancel:
            # best-effort drain of remaining items so they don't pile up
            try:
                while True:
                    item = queue.async_q.get_nowait()
                    if item is None:
                        break
                    try:
                        print(f"[{name}] drained:", item)
                    except Exception:
                        pass
                    try:
                        queue.async_q.task_done()
                    except Exception:
                        pass
            except asyncio.QueueEmpty:
                pass
            except Exception:
                # defensive: if get_nowait/queue internals raise something unexpected
                traceback.print_exc()

        print(f"🔇 {name} stopped")
