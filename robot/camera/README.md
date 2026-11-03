# Lite3 built-in camera publisher

This is the host GStreamer worker used to send the Lite3 built-in camera to the
private SRT receiver. It receives RTSP over TCP, decodes with OpenH264, encodes
H.264 baseline with x264, and sends MPEG-TS to `video/normal_cam`. It saves no video
and sends no robot movement or PTZ commands.

The pipeline is preserved from the live deployment. Deployment-specific addresses,
VPN network and interface are supplied through an environment file. The service
also includes the cache environment prepared for the deployed worker's next start.
These repository files have not been redeployed as part of packaging them.

## Preconditions

- A Linux host with systemd, Python 3, PyGObject/GStreamer bindings, and `/usr/sbin/ip`.
  The original host had GStreamer 1.24 and these dependencies already installed.
- Existing GStreamer elements: `rtspsrc`, `rtph264depay`, `h264parse`, `openh264dec`,
  `queue`, `x264enc`, `identity`, `mpegtsmux`, and `srtsink`. Check the SRT plugin
  supports `auto-reconnect`, `wait-for-connection`, and `localaddress`.
- The built-in camera reachable at `rtsp://<ROBOT_MOTION_HOST_IP>:8554/test`, with
  H.264 input negotiated as 1280×720 at 30 fps. Use the address from this robot's
  configuration; an external PTZ camera is a separate source.
- An existing VPN address and route to an SRT receiver authorized for stream ID
  `publish:video/normal_cam`. This package neither provisions the VPN nor changes
  interfaces, routes, the receiver, or camera settings.
- An existing non-root account `cerber`. Edit `User` and `Group` in the service
  template if the host uses another account. Review the VPN service dependency
  (`netbird.service`) for the target deployment.

Check installed plugins without starting any stream:

```sh
for element in rtspsrc rtph264depay h264parse openh264dec queue x264enc identity mpegtsmux srtsink; do
  gst-inspect-1.0 "$element" >/dev/null || exit 1
done
/usr/bin/python3 -c 'import gi; gi.require_version("Gst", "1.0"); from gi.repository import Gst; Gst.init(None)'
```

## Manual installation

Run on the Jetson from this directory after reviewing the files. Keep the current
service's active/enabled state for rollback. Updating a running publisher requires
a planned interruption; copying these files alone does not restart it.

**Back up existing destination files on the Jetson before overwriting anything.**
The following creates a root-only backup and verifies each copied file. Stop if
any destination is a symlink or any backup/verification fails.

```sh
sudo bash <<'SH'
set -euo pipefail
backup_dir=$(mktemp -d /var/tmp/cerber-camera-backup.XXXXXXXX)
chmod 700 "$backup_dir"
for path in /opt/cerber-camera/camera_pipeline.py /etc/cerber/camera.env /etc/systemd/system/cerber-builtin-camera.service; do
  if [ -L "$path" ]; then
    printf 'Refusing symlink destination: %s\n' "$path" >&2
    exit 1
  fi
  if [ -e "$path" ]; then
    test -f "$path"
    cp -a --parents "$path" "$backup_dir/"
    cmp -- "$path" "$backup_dir$path"
  fi
done
printf 'Verified backup: %s\n' "$backup_dir"
SH
```

Record the printed backup directory. If updating, stop the existing publisher
before installing. Install the worker and reviewed unit:

```sh
sudo install -d -o root -g root -m 755 /opt/cerber-camera /etc/cerber
sudo install -o root -g root -m 755 camera_pipeline.py /opt/cerber-camera/camera_pipeline.py
sudo install -o root -g root -m 644 cerber-builtin-camera.service /etc/systemd/system/cerber-builtin-camera.service
```

For a new installation only, copy the example to `/etc/cerber/camera.env` with
`sudo install -o root -g root -m 600 camera.env.example /etc/cerber/camera.env`.
For an upgrade, retain the existing environment file and add the new required
`CERBER_CAMERA_VPN_CIDR` setting. Use `sudoedit /etc/cerber/camera.env` to replace
all placeholders and review the interface. Keep root ownership and mode 0600.
Both SRT endpoint addresses must belong to the approved VPN CIDR. The route to
the receiver must actually use the configured VPN interface.

Validate the environment and construct the pipeline without opening RTSP or SRT:

```sh
sudo systemd-analyze verify /etc/systemd/system/cerber-builtin-camera.service
sudo systemd-run --wait --pipe --collect \
  --property=User=cerber \
  --property=EnvironmentFile=/etc/cerber/camera.env \
  --property=Environment=HOME=/tmp \
  /usr/bin/python3 /opt/cerber-camera/camera_pipeline.py --check
```

Match `User` to the reviewed unit. `--check` requires the actual installed plugins;
success prints `configuration_valid` with `streaming_started: false`. It does not
test network reachability. systemd reads the root-only environment file before
dropping privileges. Do not source an unreviewed environment file in a root shell.

Starting the service begins live publication to the configured receiver:

```sh
sudo systemctl daemon-reload
sudo systemctl start cerber-builtin-camera.service
systemctl status cerber-builtin-camera.service --no-pager
sudo journalctl -u cerber-builtin-camera.service -n 30 --no-pager
```

After verifying playback and recovery, enable boot startup if desired with
`sudo systemctl enable cerber-builtin-camera.service`. To stop publication use
`sudo systemctl stop cerber-builtin-camera.service`; use `disable` as well if boot
startup should be removed. For rollback, stop the service, restore each saved file
with `cp -a` from its matching path in the backup, reload systemd, and restore the
previous active/enabled state. A first installation has no prior files to restore;
leave the service stopped and disabled until reviewing any removal.

## Runtime behavior and verification

The worker accepts credential-free RTSP from a literal private IP address. SRT is
bound to the configured local VPN address; its destination must be within the
configured VPN CIDR. The route is checked at startup and every 10 seconds. Use a
restricted approved CIDR, not a catch-all network.

RTSP TCP timeout is 5 seconds. GStreamer errors, EOS, or no MPEG-TS output for
15 seconds cause exit; systemd retries after 5 seconds. SRT uses 300 ms latency,
a 1-second poll timeout, and no internal reconnect loop. `TimeoutStopSec=8` bounds
service shutdown. This is recovery logic, not a guarantee against every native
plugin hang; the stall check runs on the Python main loop.

Every 10 seconds, JSON logs report encoded FPS, generated MPEG-TS bitrate, CPU,
and peak RSS. Counters are measured **before the SRT sink**, so they do not prove
receiver delivery. Verify receiver ingest and actual browser decoding separately.
The unit gives GStreamer a writable cache directory while retaining a read-only
system filesystem and protected home directories. Logs can contain endpoint
addresses in GStreamer errors; review before sharing them publicly.

The original deployment was checked with a 15-second local transcode test and
live SRT ingestion followed by Chrome WebRTC playback at 1280×720. The local test
produced about 30 fps at 2.7 Mb/s MPEG-TS, using about 76% of one CPU core and
67 MiB peak RSS. Live publication later ran around 24 fps with about one CPU core
of load. These observations describe that host and scene, not a performance
guarantee or a test of this parameterized package on another machine.

Before unattended operation, check live playback, resource use, recovery after
camera/VPN interruption, and boot startup during a safe maintenance window. A
full reboot and controlled VPN-loss recovery test are not established by the
short playback test.

## Limitations

- Orin Nano has no NVENC. This pipeline uses CPU decoding and encoding; it does
  not install or change NVIDIA multimedia drivers.
- Input caps are fixed at 720p30; there is no scaler or frame-rate converter.
  A changed camera format requires a separately reviewed pipeline.
- x264 targets 2500 kbit/s, baseline profile, no B frames, and a keyframe at most
  every 30 encoded frames. Actual FPS and bitrate depend on load and scene.
- The two-buffer queue drops stale decoded frames when output falls behind.
- The receiver and any WebRTC/WHEP endpoint are separate deployments. No external
  cameras, audio, recording, GPS, or battery telemetry are configured here.
