# Jetson telemetry snapshot — 2026-11-02

Sources and service templates for the receive-only telemetry deployment tested
on Cerber's Jetson. This directory is an inspectable snapshot, not an installer.
It does not configure Ethernet, the VPN, the robot controller, camera streaming,
or the existing ROS container. Deployment requires the robot's previously
verified telemetry destination and source configuration to remain in place.

The tested path is:

```text
robot UDP -> telemetry_receiver -> ROS Humble / Cyclone DDS / domain 42
          -> subscribe-only rosbridge -> VPN gateway -> public telemetry API
```

The final deployed image was `cerber-telemetry:20261102-v4`. This repository
combines its receiver-v2 sources, full overlay build and final 20 Hz bridge
wrapper into one build context. It is not a byte-for-byte export of that image.
See [PROVENANCE.md](PROVENANCE.md) for exact source revisions and packaging edits.

## Behavior and isolation

- Receiver: no robot command subscribers, command encoders or outgoing robot UDP
  datagrams. DDS discovery and topic publication still send normal ROS traffic.
- Parses both exact legacy 212-byte and newer 220-byte RobotState frames, plus
  108-byte joint and 52-byte IMU frames. It checks datagram size, relevant header
  fields, finite published values and the configured IPv4 source. Source address
  filtering is not authentication.
- Publishes `/imu/data`, `/joint_states`, `/leg_odom`, `/leg_odom2` and
  `/us_publisher/ultrasound_distance`. Dedicated IMU packets supply IMU data.
  Controller-input packets are counted but not published. No synthetic live data.
- Bridge registers only inbound `subscribe` and `unsubscribe`, with 11 exact
  telemetry topic/type pairs. It does not register publish, service, action,
  parameter or fragmentation capabilities; the rosapi node is not launched.
  The allowlist includes optional sensor-status/PTZ topics but does not create
  those producers. `/leg_odom` is not exposed by the bridge.
- Bridge limits each topic/client to at most 20 Hz and keeps only the newest
  queued sample. Slower requested rates remain slower; raw ROS rates are unchanged.
- Bridge binds one configured VPN address, permits exact TCP peer addresses and
  ignores forwarded proxy identity. WebSocket ping/pong remains enabled.
- Two containers use Cyclone DDS, `ROS_DOMAIN_ID=42`, `ROS_LOCALHOST_ONLY=1`,
  host networking and host IPC. They retain separate PID namespaces. Fast DDS
  discovered topics but did not deliver samples during this deployment;
  switching both processes to Cyclone delivered fresh data. The underlying
  Fast DDS fault was not established.
- Units retain UID/GID 2002, `runc`, no capabilities, no device mounts, a read-only
  filesystem, bounded `/tmp`, memory/process/log limits and restart-on-failure
  behavior (`Restart=always`, five-second delay). Review UID/GID on another host.

Original mappings are retained: RPY degrees become quaternions, joints retain
original order/sign inversion, and ultrasound element 1 is published. Gyro,
acceleration, position, velocity and ultrasound scaling have not been calibrated
here. Device timestamps are not converted; ROS headers use reception time.
Battery is parsed in RobotState but is not currently published by this package.

## Build without touching the running stack

Use the existing ARM64 source-built Humble base, whose setup script is
`/opt/ros/humble/install/setup.bash`. It must already contain the ROS build
prerequisites, NumPy/Pillow and `rmw_cyclonedds_cpp`. This is not a generic Ubuntu
image and is not the Jetson host filesystem. The Dockerfile adds four Ubuntu
Python dependencies and a pinned source overlay; it does not install apt ROS
packages over the existing underlay.

Before changing anything, preserve the current base image ID under a new tag and
record the running image IDs. Do not overwrite or delete the original
`ros2_humble` container or its firmware mount. Build under a new image tag:

```sh
cd robot/telemetry
./fetch-sources.sh
# Set this to a locally verified, preserved base tag or immutable image ID.
: "${CERBER_BASE_IMAGE:?Set the preserved source-built Humble base image}"
docker build --pull=false --build-arg BASE_IMAGE="$CERBER_BASE_IMAGE" \
  -t cerber-telemetry:20261102-rebuilt .
```

The source download is SHA256 checked. Rosbridge 2.0.8 is pinned; Ubuntu package
resolution is not frozen. Resolved versions are recorded inside the image at
`/opt/cerber_bridge/ubuntu-dependency-versions.txt`. The build runs the real
rosbridge capability self-test without a ROS node/socket and the receiver's
parser tests. `rosbridge_test_msgs` is deliberately built because colcon's
package environment requires it even with rosbridge `BUILD_TESTING=OFF`.

## Review configuration and service changes

`runtime.env.example` contains placeholders, not working addresses. Create a
private copy on the Jetson at `/opt/cerber-telemetry/runtime.env` with mode 0600;
keep existing values when updating a previously configured device. Set:

- `RECEIVER_BIND_ADDRESS`: the already configured Jetson robot-facing IPv4;
- `ROBOT_ADDRESS`: the verified source IPv4 of robot telemetry;
- `RECEIVER_PORT`: the existing UDP destination port;
- `ROSBRIDGE_BIND_ADDRESS`: the Jetson's assigned VPN address;
- `ROSBRIDGE_ALLOWED_PEERS`: exact gateway TCP peer IPs, comma separated;
- `CERBER_TELEMETRY_IMAGE`: the new, locally tested image tag.

Empty/placeholder receiver addresses fail validation. The templates pass these
values as ROS parameters, replacing private defaults removed during packaging.
DDS settings stay explicit and identical in both service files. No custom
Cyclone XML profile was used in the working deployment.

Before replacing any existing file, make a dated **on-device** backup of that
file, its owner/mode and checksum, including the environment file, both unit
files and any drop-ins. Keep backups root-only and record previous image tags
and unit enabled/active states. Verify each backup before writing. If a file is
new, record that it was absent rather than inventing a backup. Preserve the
previous image until rollback has been verified.

Review `systemd/cerber-telemetry-{receiver,bridge}.service` against current units,
then install only those two units and the reviewed environment file. They own
only the exact containers `cerber-telemetry-receiver` and
`cerber-telemetry-bridge`; their pre-start/stop cleanup removes those containers.
Do not reuse those names for unrelated containers. Units depend on Docker and
order after network-online/NetBird. A missing interface causes a failed bind and
service retry; these units do not create network interfaces or VPN routes.

After a reviewed installation, reload systemd and restart these two services.
Enable boot start only after live acceptance. This snapshot intentionally does
not provide a command that overwrites the host configuration automatically.

## Validate and roll back

Parser tests need no ROS, network or robot access:

```sh
cd receiver
c++ -std=c++17 -Wall -Wextra -fsanitize=address,undefined \
  -fno-omit-frame-pointer -g -I include src/parser.cpp tests/parser_test.cpp \
  -o /tmp/cerber_parser_test
/tmp/cerber_parser_test
```

For a running, reviewed bridge, the standard-library probe requests only
subscriptions, unsubscribe and WebSocket ping. Both source IPs below must be
assigned locally and routable to the bridge; one must be allowed and the other
excluded. Include the Jetson's own VPN address temporarily in the allowlist if
using it as the allowed source:

```sh
python3 probe_bridge.py --host "$ROSBRIDGE_BIND_ADDRESS" \
  --port "$ROSBRIDGE_PORT" --allowed-source "$PROBE_ALLOWED_SOURCE" \
  --denied-source "$PROBE_DENIED_SOURCE"
```

Expect HTTP 403 for the denied peer, 101 for the allowed peer, ping/pong, rejected
`/rosout` subscription and at least two distinct timestamps for real IMU/joint
messages. `--skip-telemetry` tests access/protocol only, not data delivery.
Check receiver packet counters and fresh IMU, joints, odometry and ultrasound
through the public API. Topic discovery or an `online` flag alone is insufficient.
Do not replay the captured test fixtures into ROS or the robot.

On 2026-11-02 the live Cyclone deployment delivered those four sources through
the API. The final bridge wrapper passed capability tests and the live path was
used by the camera/telemetry panel. This repository packaging was checked
locally: 717 parser checks passed with AddressSanitizer and UndefinedBehaviorSanitizer,
plus Python/shell syntax and source/hash comparisons. It was not rebuilt or
redeployed on the Jetson because SSH was unavailable during preservation.

Rollback means stopping only these two services, restoring their verified
on-device backups and previous image references, reloading systemd, and
restoring their previous enabled/active state. If they did not exist before the
installation, remove only these newly owned units after stopping them. Do not
reset network configuration, remove the original ROS container or delete backup
images as part of telemetry rollback.
