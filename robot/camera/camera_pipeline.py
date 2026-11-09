#!/usr/bin/env python3
"""Relay the Lite3 built-in RTSP camera to the private SRT receiver.

No files contain video. On errors or stalled output, exit for systemd to restart.
The --check option validates configuration and constructs the pipeline without
opening either the RTSP or SRT connection.
"""

import argparse
import ipaddress
import json
import os
import resource
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst


PIPELINE = (
    "rtspsrc name=source protocols=tcp latency=150 "
    "drop-on-latency=true tcp-timeout=5000000 ! "
    "rtph264depay ! h264parse ! "
    "video/x-h264,stream-format=byte-stream,alignment=au ! "
    "openh264dec ! "
    "queue max-size-buffers=2 max-size-bytes=0 max-size-time=0 leaky=downstream ! "
    "video/x-raw,format=I420,width=1280,height=720,framerate=30/1 ! "
    "x264enc speed-preset=ultrafast tune=zerolatency bitrate=2500 "
    "key-int-max=30 bframes=0 threads=2 ! "
    "video/x-h264,profile=baseline,stream-format=byte-stream,alignment=au ! "
    "h264parse config-interval=-1 ! identity name=encoded ! "
    "mpegtsmux alignment=7 ! identity name=progress ! "
    "srtsink name=output mode=caller latency=300 poll-timeout=1000 "
    "auto-reconnect=false wait-for-connection=false sync=false async=false"
)
STALL_SECONDS = 15.0


def log(event, **values):
    print(json.dumps({"event": event, **values}, sort_keys=True), flush=True)


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Missing {name}")
    return value


def configuration():
    rtsp_url = required_env("CERBER_CAMERA_RTSP_URL")
    srt_uri = required_env("CERBER_CAMERA_SRT_URI")
    vpn_address = required_env("CERBER_CAMERA_VPN_ADDRESS")
    vpn_network = ipaddress.ip_network(required_env("CERBER_CAMERA_VPN_CIDR"))
    vpn_interface = required_env("CERBER_CAMERA_VPN_INTERFACE")
    rtsp = urlsplit(rtsp_url)
    srt = urlsplit(srt_uri)
    if rtsp.scheme != "rtsp" or not rtsp.hostname or not rtsp.path:
        raise ValueError("Expected an explicit RTSP camera URL")
    if rtsp.username or rtsp.password:
        raise ValueError("This built-in camera worker expects credential-free RTSP")
    if not ipaddress.ip_address(rtsp.hostname).is_private:
        raise ValueError("Camera must be a private, literal IP address")
    if srt.scheme != "srt" or not srt.hostname or not srt.port:
        raise ValueError("Expected an SRT URI with a literal IP and port")
    if ipaddress.ip_address(srt.hostname) not in vpn_network:
        raise ValueError("SRT destination must be in the approved VPN network")
    if ipaddress.ip_address(vpn_address) not in vpn_network:
        raise ValueError("SRT local address must be in the approved VPN network")
    if srt.username or srt.password or srt.fragment:
        raise ValueError("Unexpected SRT credentials or fragment")
    query = parse_qs(srt.query, strict_parsing=True)
    if query.get("streamid") != ["publish:video/normal_cam"]:
        raise ValueError("Expected the authorized normal_cam publish stream ID")
    if not vpn_interface or any(c.isspace() for c in vpn_interface):
        raise ValueError("Invalid VPN interface")
    return rtsp_url, srt_uri, vpn_address, vpn_interface, srt.hostname


def verify_vpn_route(destination, interface):
    result = subprocess.run(
        ["/usr/sbin/ip", "-j", "route", "get", destination],
        capture_output=True,
        text=True,
        timeout=3,
        check=True,
    )
    routes = json.loads(result.stdout)
    if not routes or routes[0].get("dev") != interface:
        raise RuntimeError("SRT destination is not currently routed through VPN")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rtsp_url, srt_uri, vpn_address, vpn_interface, destination = configuration()
    Gst.init(None)
    pipeline = Gst.parse_launch(PIPELINE)
    pipeline.get_by_name("source").set_property("location", rtsp_url)
    output = pipeline.get_by_name("output")
    output.set_property("uri", srt_uri)
    output.set_property("localaddress", vpn_address)
    if args.check:
        log("configuration_valid", streaming_started=False)
        return 0

    verify_vpn_route(destination, vpn_interface)
    stopping = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda _signum, _frame: stopping.set())

    started = time.monotonic()
    progress = {"last_output": started, "buffers": 0, "bytes": 0, "frames": 0}

    def record_output(_pad, info):
        buffer = info.get_buffer()
        if buffer is not None:
            progress["last_output"] = time.monotonic()
            progress["buffers"] += 1
            progress["bytes"] += buffer.get_size()
        return Gst.PadProbeReturn.OK

    def record_encoded(pad, info):
        if info.get_buffer() is not None:
            progress["frames"] += 1
            if progress["frames"] == 1:
                caps = pad.get_current_caps()
                log("first_encoded_frame", caps=caps.to_string() if caps else None)
        return Gst.PadProbeReturn.OK

    pipeline.get_by_name("progress").get_static_pad("src").add_probe(
        Gst.PadProbeType.BUFFER, record_output
    )
    pipeline.get_by_name("encoded").get_static_pad("src").add_probe(
        Gst.PadProbeType.BUFFER, record_encoded
    )
    bus = pipeline.get_bus()
    last_report = started
    last_bytes = last_frames = 0
    initial_usage = resource.getrusage(resource.RUSAGE_SELF)
    last_cpu = initial_usage.ru_utime + initial_usage.ru_stime
    exit_code = 0

    try:
        state = pipeline.set_state(Gst.State.PLAYING)
        if state == Gst.StateChangeReturn.FAILURE:
            log("startup_failed")
            return 1
        log("starting", watchdog_seconds=STALL_SECONDS)
        while not stopping.is_set():
            message = bus.timed_pop_filtered(
                200 * Gst.MSECOND,
                Gst.MessageType.ERROR | Gst.MessageType.EOS | Gst.MessageType.WARNING,
            )
            if message is not None:
                if message.type == Gst.MessageType.ERROR:
                    error, debug = message.parse_error()
                    log("pipeline_error", message=str(error), debug=debug)
                    exit_code = 1
                    break
                if message.type == Gst.MessageType.EOS:
                    log("unexpected_end_of_stream")
                    exit_code = 1
                    break
                error, debug = message.parse_warning()
                log("pipeline_warning", message=str(error), debug=debug)

            now = time.monotonic()
            if now - progress["last_output"] > STALL_SECONDS:
                log("stalled_output", seconds=round(now - progress["last_output"], 2))
                exit_code = 1
                break

            if now - last_report >= 10:
                verify_vpn_route(destination, vpn_interface)
                interval = now - last_report
                usage = resource.getrusage(resource.RUSAGE_SELF)
                cpu = usage.ru_utime + usage.ru_stime
                log(
                    "progress",
                    frames_total=progress["frames"],
                    encoded_fps=round((progress["frames"] - last_frames) / interval, 2),
                    mpegts_mbit_s=round((progress["bytes"] - last_bytes) * 8 / interval / 1e6, 3),
                    process_cpu_percent=round((cpu - last_cpu) * 100 / interval, 2),
                    max_rss_kib=usage.ru_maxrss,
                )
                last_report, last_bytes, last_frames, last_cpu = (
                    now, progress["bytes"], progress["frames"], cpu
                )
    except Exception as error:
        log("runtime_error", message=str(error))
        exit_code = 1
    finally:
        # systemd TimeoutStopSec is a final bound if a native network plugin hangs.
        pipeline.set_state(Gst.State.NULL)
        pipeline.get_state(3 * Gst.SECOND)
        log("stopped", frames_total=progress["frames"], exit_code=exit_code)
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        log("fatal", message=str(error))
        sys.exit(1)
