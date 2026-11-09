#!/usr/bin/env python3
"""Pinned rosbridge 2.0.8 with inbound subscribe/unsubscribe operations only.

The upstream server is run directly, without the standard launch file or rosapi
node. This wrapper does not alter installed rosbridge source files. WebSocket
telemetry is limited to 20 Hz per topic/client with a latest-message-only queue;
ROS publishers and their original sampling rates are unaffected.
"""

from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import runpy
import sys

MIN_THROTTLE_MS = 50
TELEMETRY_QUEUE_LENGTH = 1

TOPICS = {
    "/imu/data": "sensor_msgs/Imu",
    "/joint_states": "sensor_msgs/JointState",
    "/leg_odom2": "nav_msgs/Odometry",
    "/us_publisher/ultrasound_distance": "std_msgs/Float64",
    "/ptz/status": "std_msgs/String",
    "/sensor_status/imu_isalive": "std_msgs/Bool",
    "/sensor_status/odom2_isalive": "std_msgs/Bool",
    "/sensor_status/joint_isalive": "std_msgs/Bool",
    "/sensor_status/realsense_isalive": "std_msgs/Bool",
    "/sensor_status/lidar_isalive": "std_msgs/Bool",
    "/sensor_status/ultrasound_isalive": "std_msgs/Bool",
}


def validate_request(raw: str) -> dict:
    """Accept a complete JSON subscription message, without fragments/aliases."""
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 4096:
        raise ValueError("Expected one JSON text message of at most 4096 bytes")
    def reject_constant(_value):
        raise ValueError("Non-finite JSON numbers are not allowed")
    message = json.loads(raw, parse_constant=reject_constant)
    if not isinstance(message, dict):
        raise ValueError("Expected a JSON object")
    if message.get("op") not in ("subscribe", "unsubscribe"):
        raise ValueError("Only subscribe and unsubscribe operations are allowed")
    allowed_fields = {"op", "id", "topic"}
    if message["op"] == "subscribe":
        allowed_fields.update({"type", "compression", "throttle_rate", "queue_length"})
    if set(message) - allowed_fields:
        raise ValueError("Unsupported telemetry subscription field")
    if "id" in message and (not isinstance(message["id"], str) or len(message["id"]) > 256):
        raise ValueError("Request ID must be a short string")
    topic = message.get("topic")
    if not isinstance(topic, str) or topic not in TOPICS:
        raise ValueError("Topic is not in the telemetry allowlist")
    if message["op"] == "subscribe":
        expected = TOPICS[topic]
        full_type = expected.replace("/", "/msg/", 1)
        if message.get("type", expected) not in (expected, full_type):
            raise ValueError("Message type does not match the telemetry topic")
        # Explicit type prevents discovery/service calls for unavailable sensors.
        message["type"] = expected
        if message.get("compression", "none") != "none":
            raise ValueError("Only uncompressed JSON telemetry is supported")
        for key, maximum in (("throttle_rate", 60000), ("queue_length", 16)):
            value = message.get(key, 0)
            if type(value) is not int or not 0 <= value <= maximum:
                raise ValueError("Invalid subscription queue or throttle setting")
        # Gateway requests zero throttling by default. Cap only the outbound
        # WebSocket subscription, retaining the newest queued sample. Requests
        # for a slower stream keep their longer interval. ROS rates are intact.
        message["throttle_rate"] = max(MIN_THROTTLE_MS, message.get("throttle_rate", 0))
        message["queue_length"] = TELEMETRY_QUEUE_LENGTH
    return message


def make_protocol_class():
    # Derive from the base Protocol, not RosbridgeProtocol: no publishing,
    # service, action, defragmentation, or parameter capability is instantiated.
    from rosbridge_library.protocol import Protocol
    from rosbridge_library.capabilities.subscribe import Subscribe

    class TelemetryProtocol(Protocol):
        def __init__(self, client_id, node_handle, parameters=None):
            safe = dict(parameters or {})
            safe.update(
                topics_glob=[],
                topics_pub_glob=[],
                topics_sub_glob=list(TOPICS),
                services_glob=[],
                actions_glob=[],
                bson_only_mode=False,
            )
            super().__init__(client_id, node_handle, safe)
            self.add_capability(Subscribe)
            if set(self.operations) != {"subscribe", "unsubscribe"}:
                raise RuntimeError("Unexpected rosbridge operation registered")

        def incoming(self, message_string=""):
            try:
                message = validate_request(message_string)
            except (TypeError, ValueError):
                self.send({
                    "op": "status", "level": "error",
                    "msg": "Read-only telemetry bridge rejected this request",
                })
                return
            super().incoming(json.dumps(message, allow_nan=False))

    return TelemetryProtocol


def self_test():
    """Use real rosbridge classes, but no ROS init/node/socket/robot access."""
    from unittest.mock import patch
    from rosbridge_library.capabilities.subscribe import Subscribe

    class NoRosNode:
        def __getattr__(self, name):
            raise AssertionError("Test attempted to access ROS node: " + name)

    protocol_type = make_protocol_class()
    protocol = protocol_type("safety-test", NoRosNode(), {
        "topics_glob": ["*"], "topics_pub_glob": ["*"],
        "services_glob": ["*"], "actions_glob": ["*"],
    })
    outgoing = []
    protocol.outgoing = lambda data, compression="none": outgoing.append(json.loads(data))
    assert set(protocol.operations) == {"subscribe", "unsubscribe"}
    assert protocol.parameters["topics_pub_glob"] == []
    assert protocol.parameters["services_glob"] == []
    assert protocol.parameters["actions_glob"] == []
    denied = (
        "publish", "advertise", "unadvertise", "call_service", "advertise_service",
        "unadvertise_service", "service_response", "send_action_goal", "cancel_action_goal",
        "advertise_action", "unadvertise_action", "action_feedback", "action_result",
        "fragment", "set_param", "set_level",
    )
    for operation in denied:
        protocol.incoming(json.dumps({"op": operation, "topic": "/imu/data"}))
    for topic in ("/cmd_vel", "/simple_cmd", "imu/data", "/imu/../cmd_vel", "/rosout"):
        protocol.incoming(json.dumps({"op": "subscribe", "topic": topic}))
    for raw in ("[]", "null", "{", '{"op":"subscribe","topic":[]}',
                '{"op":"subscribe","topic":"/imu/data","type":"std_msgs/String"}',
                '{"op":"fragment","data":"{\\"op\\":\\"publish\\"}"}',
                '{"op":"subscribe","topic":"/imu/data","fragment_size":0}',
                '{"op":"subscribe","topic":"/imu/data","message_intervall":10}',
                '{"op":"subscribe","topic":"/imu/data","queue_length":1000000}'):
        protocol.incoming(raw)
    assert len(outgoing) == len(denied) + 5 + 9
    assert all(message["op"] == "status" and message["level"] == "error" for message in outgoing)
    protocol.finish()

    # Verify every allowed topic reaches the real capability dispatch. Mock only
    # its ROS-facing methods; registration, filtering, and parser remain real.
    with patch.object(Subscribe, "subscribe") as subscribe, patch.object(Subscribe, "unsubscribe") as unsubscribe:
        protocol = protocol_type("dispatch-test", NoRosNode())
        for topic, message_type in TOPICS.items():
            protocol.incoming(json.dumps({"op": "subscribe", "topic": topic, "type": message_type}))
            protocol.incoming(json.dumps({"op": "unsubscribe", "topic": topic}))
        assert subscribe.call_count == len(TOPICS)
        assert unsubscribe.call_count == len(TOPICS)
        for call in subscribe.call_args_list:
            assert call.args[0]["throttle_rate"] == MIN_THROTTLE_MS
            assert call.args[0]["queue_length"] == TELEMETRY_QUEUE_LENGTH
        # Validate both default and explicit client requests at the real
        # protocol dispatch boundary, not just the configuration constants.
        for requested, expected in ((0, 50), (10, 50), (50, 50), (100, 100)):
            protocol.incoming(json.dumps({
                "op": "subscribe", "topic": "/imu/data", "type": "sensor_msgs/Imu",
                "throttle_rate": requested, "queue_length": 16,
            }))
            dispatched = subscribe.call_args.args[0]
            assert dispatched["throttle_rate"] == expected
            assert dispatched["queue_length"] == 1
        protocol.finish()
    print("TELEMETRY_BRIDGE_SELF_TEST_OK: 11 allowed topics; mutation operations rejected; maximum 20 Hz/topic with latest-only queue; no ROS node or sockets")


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if sys.argv[1:]:
        raise SystemExit("No CLI overrides accepted; configure using ROSBRIDGE_BIND_ADDRESS/ALLOWED_PEERS/PORT")

    address = str(ipaddress.ip_address(os.environ["ROSBRIDGE_BIND_ADDRESS"]))
    if ipaddress.ip_address(address).is_unspecified or ipaddress.ip_address(address).is_multicast:
        raise SystemExit("ROSBRIDGE_BIND_ADDRESS must be one specific interface address")
    allowed_peers = frozenset(
        str(ipaddress.ip_address(value.strip()))
        for value in os.environ["ROSBRIDGE_ALLOWED_PEERS"].split(",") if value.strip()
    )
    if not allowed_peers:
        raise SystemExit("ROSBRIDGE_ALLOWED_PEERS must contain at least one exact IP address")
    port = int(os.environ.get("ROSBRIDGE_PORT", "9090"))
    if not 1024 <= port <= 65535:
        raise SystemExit("ROSBRIDGE_PORT must be between 1024 and 65535")

    from ament_index_python.packages import get_package_prefix
    import rosbridge_server
    from rosbridge_server import websocket_handler
    from tornado.web import HTTPError

    protocol_type = make_protocol_class()
    websocket_handler.RosbridgeProtocol = protocol_type
    original_handler = rosbridge_server.RosbridgeWebSocket

    class TelemetryWebSocket(original_handler):
        def prepare(self):
            # TCP peer from Tornado; proxy headers are not trusted/enabled.
            try:
                peer = str(ipaddress.ip_address(self.request.remote_ip))
            except ValueError:
                raise HTTPError(403)
            if peer not in allowed_peers:
                raise HTTPError(403)
            return super().prepare()

    rosbridge_server.RosbridgeWebSocket = TelemetryWebSocket
    # Upstream's exception logger also resolves this module global. Keep it in
    # sync with the exported class receiving node_handle/event_loop attributes.
    websocket_handler.RosbridgeWebSocket = TelemetryWebSocket
    server = Path(get_package_prefix("rosbridge_server")) / "lib/rosbridge_server/rosbridge_websocket.py"
    if not server.is_file():
        raise SystemExit("Pinned rosbridge server executable was not found")
    sys.argv = [str(server), "--ros-args",
                "-p", f"address:={address}", "-p", f"port:={port}",
                "-p", "max_message_size:=4096", "-p", "incoming_queue_size:=32",
                "-p", "write_queue_size:=64", "-p", "websocket_ping_interval:=20.0",
                "-p", "websocket_ping_timeout:=30.0"]
    print(f"Starting subscribe-only rosbridge on {address}:{port}; {len(allowed_peers)} permitted TCP peers; maximum 20 Hz/topic with latest-only queue", flush=True)
    runpy.run_path(str(server), run_name="__main__")


if __name__ == "__main__":
    main()
