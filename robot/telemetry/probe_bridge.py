#!/usr/bin/env python3
"""Read-only WebSocket smoke test; run on Jetson using only Python stdlib.

Requests: WebSocket ping, allowed/disallowed telemetry subscriptions, unsubscribe.
No publish, service, action or parameter requests are ever emitted.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import time


class Connection:
    def __init__(self, host, port, source):
        self.sock = socket.create_connection((host, port), timeout=5, source_address=(source, 0))
        self.buffer = bytearray()
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        while b"\r\n\r\n" not in self.buffer:
            block = self.sock.recv(4096)
            if not block:
                raise RuntimeError("Connection closed before HTTP response")
            self.buffer.extend(block)
            if len(self.buffer) > 65536:
                raise RuntimeError("Oversized HTTP headers")
        headers, extra = self.buffer.split(b"\r\n\r\n", 1)
        self.buffer = bytearray(extra)
        lines = headers.decode("latin-1").split("\r\n")
        self.status = int(lines[0].split()[1])
        if self.status == 101:
            expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
            # Header names are case-insensitive; base64 values are not.
            parsed = {line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip() for line in lines[1:]}
            if parsed.get("sec-websocket-accept") != expected:
                raise RuntimeError("Invalid WebSocket handshake accept value")

    def read_exact(self, size):
        while len(self.buffer) < size:
            block = self.sock.recv(max(4096, size - len(self.buffer)))
            if not block:
                raise EOFError("WebSocket closed")
            self.buffer.extend(block)
        out = bytes(self.buffer[:size])
        del self.buffer[:size]
        return out

    def send(self, data, opcode=1):
        if isinstance(data, str):
            data = data.encode()
        size = len(data)
        if size < 126:
            prefix = bytes((0x80 | opcode, 0x80 | size))
        elif size <= 65535:
            prefix = bytes((0x80 | opcode, 0x80 | 126)) + struct.pack("!H", size)
        else:
            prefix = bytes((0x80 | opcode, 0x80 | 127)) + struct.pack("!Q", size)
        mask = os.urandom(4)
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.sock.sendall(prefix + mask + payload)

    def receive(self, deadline):
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("WebSocket response deadline reached")
            self.sock.settimeout(remaining)
            head = self.read_exact(2)
            final, opcode, masked = bool(head[0] & 0x80), head[0] & 15, bool(head[1] & 0x80)
            size = head[1] & 127
            if size == 126:
                size = struct.unpack("!H", self.read_exact(2))[0]
            elif size == 127:
                size = struct.unpack("!Q", self.read_exact(8))[0]
            if masked or size > 1048576 or not final:
                raise RuntimeError("Unexpected frame format or size")
            payload = self.read_exact(size)
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 8:
                raise EOFError("Server closed WebSocket")
            return opcode, payload

    def close(self):
        if self.status == 101:
            try:
                self.send(struct.pack("!H", 1000), 8)
            except OSError:
                pass
        self.sock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=9090)
    parser.add_argument("--allowed-source", required=True)
    parser.add_argument("--denied-source", required=True)
    parser.add_argument("--skip-telemetry", action="store_true")
    args = parser.parse_args()

    denied = Connection(args.host, args.port, args.denied_source)
    try:
        if denied.status != 403:
            raise RuntimeError(f"Denied source returned HTTP {denied.status}, expected 403")
        print("PEER_DENIAL_OK: HTTP 403", flush=True)
    finally:
        denied.close()

    accepted = Connection(args.host, args.port, args.allowed_source)
    try:
        if accepted.status != 101:
            raise RuntimeError(f"Allowed source returned HTTP {accepted.status}, expected 101")
        print("PEER_ACCEPT_OK: HTTP 101", flush=True)
        token = os.urandom(8)
        accepted.send(token, 9)
        opcode, payload = accepted.receive(time.monotonic() + 5)
        if opcode != 10 or payload != token:
            raise RuntimeError("WebSocket ping did not receive matching pong")
        print("WEBSOCKET_PING_PONG_OK", flush=True)
        accepted.send(json.dumps({"op": "subscribe", "topic": "/rosout", "id": "readonly-probe-denied"}))
        opcode, payload = accepted.receive(time.monotonic() + 5)
        denied_message = json.loads(payload)
        if opcode != 1 or denied_message.get("op") != "status" or denied_message.get("level") != "error":
            raise RuntimeError("Non-allowlisted subscription was not rejected")
        print("TOPIC_DENIAL_OK: /rosout subscription rejected", flush=True)
        if args.skip_telemetry:
            return 0

        topics = {"/imu/data": "sensor_msgs/Imu", "/joint_states": "sensor_msgs/JointState"}
        for topic, kind in topics.items():
            accepted.send(json.dumps({"op": "subscribe", "topic": topic, "type": kind,
                                      "id": "readonly-probe:" + topic, "throttle_rate": 100,
                                      "queue_length": 1}))
        counts = dict.fromkeys(topics, 0)
        stamps = {topic: set() for topic in topics}
        deadline = time.monotonic() + 12
        try:
            while not all(counts[t] >= 2 and len(stamps[t]) >= 2 for t in topics):
                opcode, payload = accepted.receive(deadline)
                if opcode != 1:
                    continue
                message = json.loads(payload)
                topic = message.get("topic")
                if message.get("op") != "publish" or topic not in topics:
                    continue
                counts[topic] += 1
                stamp = message["msg"].get("header", {}).get("stamp")
                if stamp is not None:
                    stamps[topic].add(json.dumps(stamp, sort_keys=True))
        except TimeoutError:
            print("TELEMETRY_NOT_CONFIRMED " + json.dumps(counts), flush=True)
            return 3
        finally:
            for topic in topics:
                accepted.send(json.dumps({"op": "unsubscribe", "topic": topic,
                                          "id": "readonly-probe:" + topic}))
        print("LIVE_TELEMETRY_OK " + json.dumps({t: {"messages": counts[t], "distinct_stamps": len(stamps[t])} for t in topics}), flush=True)
        return 0
    finally:
        accepted.close()


if __name__ == "__main__":
    raise SystemExit(main())
