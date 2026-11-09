# Quectel GNSS → MQTT

Standalone C publisher adapted from the existing firmware `Interp4GPSComm`
program (`robot_gps`), retaining its minmea parser. It receives actual Quectel
RMC/GGA data and publishes the canonical public-API GPS format on
`cerber/gps/data`. It does not command robot motion or configure LTE, SIM,
network interfaces, routes or the existing ModemManager primary port.

## Build and tests

Linux prerequisites: C compiler, CMake, pkg-config, libcJSON and libmosquitto
development files; Python 3 for the isolated integration test. On Ubuntu the
development packages are `libcjson-dev` and `libmosquitto-dev` (plus the usual
compiler/CMake/pkg-config tooling). No camera, SRT or ROS build is needed.

```sh
cmake -S robot/gps -B /tmp/cerber-gps-build -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/cerber-gps-build -j2
ctest --test-dir /tmp/cerber-gps-build --output-on-failure
```

Parser tests cover real NMEA semantics, validity, time pairing, UTC dates,
rollover, freshness and canonical JSON. Serial tests use private PTYs for AT
responses, errors, timeout, exclusive locking and termios restoration. The
integration test uses a separately compiled PTY-only binary and a localhost
fake broker: no real modem, robot, GPS coordinates or production broker is used.
`robot_gps_test_devices` is a test artifact and must never be installed.

## Configuration and safe deployment

All runtime settings come from the environment. Copy `runtime.env.example` to
`/etc/cerber/gps.env` on the Jetson and fill in the existing broker/VPN
addresses. Keep it root-owned and mode 0600. The service manager reads it before
dropping to `cerber` with supplementary group `dialout`. The topic defaults to
`cerber/gps/data`; all other shown settings are required. Only literal nonzero
IPv4 broker/bind addresses are accepted.

Device paths must identify the **same Quectel** using `/dev/serial/by-id/`:
NMEA interface `if01-port0`, secondary AT interface `if03-port0`. Interface
`if02-port0` is intentionally rejected because ModemManager owns the primary AT
port. There is no fallback to an unstable `/dev/ttyUSB*` index.

Before overwriting any existing binary, environment file or systemd unit,
make and verify copies **on the Jetson**, preserving permissions and ownership.
Keep the original firmware checkout untouched. Install only the tested
`robot_gps` binary at `/opt/cerber-gps/robot_gps` and the reviewed service template
at `/etc/systemd/system/cerber-gps.service`.

Before starting, check both selected ports using `sudo fuser` and stop if
another process owns either one. Do not stop ModemManager or use its primary
AT interface. The program uses `flock` plus `TIOCEXCL`; these prevent cooperating
or later opens but cannot retroactively evict an already-open reader. Do not
run manual NMEA/AT readers in parallel with the service.

`robot_gps --check-config` validates the environment without opening devices,
starting GNSS or connecting to MQTT. It does not verify device ownership,
reachability or actual antenna/fix quality. systemd runs this check before
starting the worker. Review the environment and unit, then reload systemd,
start `cerber-gps`, and check its journal before enabling boot startup.

On rollback, stop and disable only the new GPS service (or restore its prior
enabled state), restore verified backups, and reload systemd. The existing
camera/telemetry services are unrelated and need not be restarted.

## Runtime behavior

- On secondary AT: send `AT+QGPS?`, enable with `AT+QGPS=1` only when disabled,
  then verify the enabled state. Every response must contain `OK`; reads/writes
  have bounded three-second deadlines. No other AT commands are issued.
- Serial settings are saved and restored on close; shutdown handles SIGINT and
  SIGTERM. Stop does **not** turn GNSS off. Startup AT work can take up to nine
  seconds, so the service allows fifteen seconds for shutdown.
- Flush old NMEA on initial open and successful MQTT connection. RMC and GGA
  must share one UTC epoch (including fractional seconds), be checksummed,
  valid and received within two seconds. UTC date comes from the matching RMC.
  Invalid RMC or GGA fix zero invalidates the current position. No missing,
  stale or NaN coordinates are replaced with zero; actual geographic zeros
  remain valid.
- Receiver status on `GPS_MQTT_STATUS_TOPIC` (default `cerber/gps/status`, must
  differ from the data topic): `{"fix", "satellites", "nmea_alive", "published"}`,
  right after each (re)connection and then every five seconds, with or without
  a fix. It carries no coordinates; the API shows it as `gps_receiver`, so the
  panel can tell "waiting for satellites" from "publisher down".
- Publish at most once per second, QoS 0, retain false, only when connected and
  a complete fresh fix exists. JSON fields are `latitude`, `longitude`,
  `altitude`, `satellites`, `fix_quality`, `date` (ISO 8601 UTC).
- MQTT uses a clean session and the configured VPN source IPv4. A lost client
  is destroyed and retried after three seconds, with no retained outbound
  sample to replay. Serial parsing continues while MQTT connects. A successful
  connection clears partial parser state and the serial input backlog.
- Device loss or thirty seconds without serial bytes exits nonzero for systemd
  to restart. No satellite fix is an expected condition: the service continues
  reading and logs `no_fix`, counts and satellites, without inventing a position.
- Logs omit coordinates. `published` counts requests accepted by libmosquitto,
  not end-to-end delivery; confirm fresh `gps_at` in the API independently.

The API keeps its latest accepted GPS fix after a later signal loss. Consumers
must use `gps_at` to detect staleness. The publisher does not refresh that age
with an old position merely to report missing satellites.

## Provenance

The original C program came from `/opt/firmware/Interp4GPSComm` in firmware
commit `6cb314a7a79201f7d6d628e17030fb9c794088a9`, authored by Michał Sadecki
(2026). This adaptation retains its language, executable name, parser library
and serial-to-MQTT architecture. It fixes the old short JSON field names,
compile-time broker address, unverified AT write, boolean error return and
local-time serialization, and adds bounded ownership/lifecycle handling.
Original author notices are preserved; no blanket relicensing of inherited
code is asserted here.

`lib/inc/minmea.h` and `lib/src/minmea.c` are preserved from that checkout with
their original Kosma Moczek copyright and WTFPL v2 notice; see `lib/COPYING`.
Device-specific environment files, captures containing locations and credentials
are not included in this repository.
