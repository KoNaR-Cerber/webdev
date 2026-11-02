# Source provenance and packaging changes

Snapshot date: 2026-11-02. These files preserve the source used for the tested
Cerber telemetry deployment, with configuration sanitization described below.
They do not include credentials, device-specific IPs, original private network
configuration, compiled artifacts or the pre-existing ROS base image.

## Receiver

The receive-only implementation is the final `receiver-v2` package. Parser,
message mappings, CMake and tests are preserved. Two private IPv4 defaults in
`src/receiver.cpp` were replaced with empty strings; service templates now pass
explicit configured addresses via ROS parameters. Validation already rejects
empty/unspecified addresses. A provenance comment in `legacy_wire.hpp` now
points here rather than to an omitted full vendor header. Trailing whitespace
in the two wire headers was normalized without changing declarations.

The initial wire declarations and mappings came from the existing firmware
checkout at commit `6cb314a`:

| Original relative path | SHA256 |
| --- | --- |
| `ros2/lite3_ws/src/transfer/include/protocol.hpp` | `df60817a96e7a813cb7e5dfc7a60258a2207363c41fcea48651fee7c5042fd9c` |
| `ros2/lite3_ws/src/transfer/src/Jetson2Motion.cpp` | `c41e50cea208f8f6e959e34f77f35ae0cdf62bb1d77540294ae1aff81e4d6819` |

Only receive-side wire declarations are retained in `wire.hpp`. The complete
original files are not distributed here: they are not build inputs and include
unrelated command code/device-specific network settings.

The exact older 212-byte RobotState layout is preserved separately in
`legacy_wire.hpp`, from [DeepRoboticsLab/Lite3_ROS commit
5c8a1f8ec5e5fdb19c7d1cfbebb274ef259a5bcb](https://github.com/DeepRoboticsLab/Lite3_ROS/blob/5c8a1f8ec5e5fdb19c7d1cfbebb274ef259a5bcb/src/transfer/include/protocol.hpp).
The downloaded original header SHA256 was
`b336eacaf6dac8152c898c85c2198145372351f3567938451ca7ffc3678ec02c`.

Header size/type/sequence semantics were checked against the separate
[Lite3_MotionSDK command header](https://github.com/DeepRoboticsLab/Lite3_MotionSDK/blob/main/include/common/command.h).
That downloaded reference had SHA256
`da5a33e50f6fcaf731d7a4c4938a1451027cfe71cfb19262798f1b1f6d3bce69`;
its source URL used `main`, so the hash records the inspected version. The full
header is not compiled or included in this snapshot.

`tests/captured_frames.hpp` contains only two real UDP payload fixtures from a
passive capture on 2026-11-02. Corresponding RobotState/IMU values agree and are
checked alongside malformed/synthetic fixtures. The full capture JSON contained
network metadata and is intentionally omitted. These bytes never enter the live
receiver path or get published by tests.

Original final receiver source hashes, before the documented default/comment
sanitization:

| File | SHA256 |
| --- | --- |
| `src/receiver.cpp` | `b43c74c627687f38cf80a7856d0898e258893c04149b589117566183ffb7938b` |
| `src/parser.cpp` | `24ab78c5d90286edaad6dafc13db1e9b4047713bcedbdff51c6ac8f2c30d9eca` |
| `include/cerber_telemetry/wire.hpp` | `9fc0a80ab0461344f906788237ab677dae92b7d3452c48aa066113757875dd1e` |
| `include/cerber_telemetry/legacy_wire.hpp` | `711ec518c9cae12a5af03e497fcd85b5792781e8ad55147b706fc3c080e7e2ea` |
| `tests/parser_test.cpp` | `01e54e50c1a3af2bfb9b9d2b4190c2e97b8ca6a2694e7912fd27fa7f66d19c1e` |
| `tests/captured_frames.hpp` | `f0f8bd5dc921f7008f7d7a082a8b65a4434274fdd7e45c3dbde0f72648597ffa` |

The downloaded current Lite3_ROS MIT notice (copyright 2023 DeepRoboticsLab) is
preserved in `receiver/provenance/DeepRoboticsLab-LICENSE`. This does not establish
a new license for the original firmware checkout or the separate MotionSDK
header. The firmware transfer package did not specify a meaningful license;
`package.xml` consequently retains `LicenseRef-Inherited-Firmware-Not-Specified`.
No blanket relicensing of inherited source is claimed.

## Rosbridge and image assembly

- Upstream: [RobotWebTools/rosbridge_suite, release 2.0.8](https://github.com/RobotWebTools/rosbridge_suite/tree/54868a228d8c05cc60cb85d6e4813a3271283e31).
- Commit: `54868a228d8c05cc60cb85d6e4813a3271283e31`.
- Archive SHA256: `383cb4acb444bbbd877639b348e49bf9512dd3b6a1803b0707d53668c046120f`.
- License: BSD 3-Clause; the exact archive notice is preserved at
  `third_party/rosbridge-LICENSE`. Keep that notice with redistributed binaries.
- `telemetry_bridge.py` is the final 20 Hz wrapper, byte-identical to the deployed
  build input: SHA256 `7152a01af4a41646a6e7cbf56b386a85c1ac4f713182dbe96c68104421802900`.

The final incremental build context (`context-v5`) only replaced that wrapper
on top of image `cerber-telemetry:20261102-v3`, producing v4. The repository's
Dockerfile consolidates the preceding full source-overlay Dockerfile
(`context-v4`), receiver-v2 and final wrapper. Its base-image default was removed:
a preserved compatible local base must be supplied explicitly. The downloaded
rosbridge archive is verified before extraction and is not committed as bulk
vendor source. Ubuntu Python package versions remain resolved at build time.

The original source-built Humble base image used in the deployment had local
image ID `sha256:a6acba6eb3383e3c01d91d9e4591e8835754422b7a8586f264e2d148dbf4deaa`.
An image ID is provenance, not a remotely pullable artifact. The base is not
redistributed here; preserving this repository alone does not preserve it.

## Service templates

The retained service structure comes from the prepared units, with the known
final configuration (`rmw_cyclonedds_cpp`, domain 42, localhost DDS, v4 image)
represented in parameterized templates. Device-specific image/address selection
is now supplied by `runtime.env`; no PID-host option is present. The local saved
unit drafts still referenced v2/Fast DDS, so these are reviewed reconstructions
of the final settings, not claimed fresh exports from the device. SSH was
unavailable when this repository snapshot was prepared.
