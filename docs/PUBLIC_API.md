# Cerber public API for the robot and the drone

This document is for teams integrating with the Cerber platform. It covers robot telemetry over REST and
WebSocket, and video from the robot and drone cameras over WebRTC. Everything is served from one host,
`cerber.machinekind.ai`. We send the API key through a separate channel.

```
                        https://cerber.machinekind.ai
  /health, /api/v1/robots/*  ──► telemetry gateway (REST, WS; API key)
  /video/<path>/whep         ──► MediaMTX (WebRTC/WHEP; no key)
  /docs, /openapi.json       ──► interactive docs and OpenAPI 3.1 contract
```

Rules:

- The API is **read-only**. It does not expose control of the robot or the drone, and this API never will.
- Telemetry requires an API key. Camera video is public and needs no key, because a browser cannot keep a secret.
- The web dashboard at `/` is reachable only from the project VPN and is not part of the public offering.
  The public parts are the telemetry API, `/docs`, `/openapi.json` and `/video/*`.
- The environment is a staging setup prepared for demos. The robot is online only during tests and demos.
  The `*/demo` streams always run, so you can build an integration without hardware.
- The contract (`openapi.json`, JSON schemas, examples) is generated from the code and versioned with it.
  We announce breaking changes before we deploy them.

## 1. API key

| Where | How |
|---|---|
| REST | header `X-API-Key: <key>` |
| WebSocket | query parameter `?api_key=<key>` (browsers cannot set the header) |

A wrong or missing key returns `401 {"detail": "..."}` on REST. On WS the server accepts the connection and
closes it immediately with code `4401`. Keep the key out of repositories, logs and public chats. If it leaks,
we rotate it on our side and send you a new one. Do **not** put the key in REST query strings.

## 2. Robot telemetry: REST

Base URL: `https://cerber.machinekind.ai`. Robot ID: `cerber-lite3-01`. `/api/v1/robots` lists all robots.

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `Health` with the gateway state and its connections to the robot. No key needed. |
| GET | `/api/v1/robots` | `RobotList` |
| GET | `/api/v1/robots/{robot_id}` | `RobotSummary` (`online`, `last_seen`) |
| GET | `/api/v1/robots/{robot_id}/telemetry/latest` | `TelemetrySnapshot` with the last known state of every source |
| GET | `/api/v1/robots/{robot_id}/gps/latest` | `GPSFix`, or `404` if no position has arrived yet |
| GET | `/api/v1/robots/{robot_id}/streams` | `VideoStreamList` with the WHEP URLs of the robot cameras |

```bash
export CERBER_KEY=...   # from the separate channel
curl -s https://cerber.machinekind.ai/health
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.machinekind.ai/api/v1/robots
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/telemetry/latest
```

Call `/health` to decide whether to request data at all. It needs no key.

```json
{"status": "degraded", "version": "1.0.0", "rosbridge_connected": false, "mqtt_connected": true, "ts": 1793605324.49}
```

`status` is `ok` when both sources are connected, and `degraded` otherwise. `degraded` with
`rosbridge_connected: false` means the robot is off or outside the VPN. The API still responds, but ROS data
stops updating.

### Field meanings

- `online` means the robot has an open connection to the gateway **and** sent something in the last 5 s.
- `last_seen` is the time of the last message from the robot, in epoch seconds as a float.
- `TelemetrySnapshot` has the sections `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps` and
  `sensors_alive`. Each section has a receive time `*_at`. A section stays `null` until data of its type
  arrives after the gateway starts. The `status` field is computed when the response is built.
- All times (`ts`, `*_at`, `last_seen`) are server receive times (epoch). The robot clock is not used.
- Units: angles in radians, angular velocities in rad/s, accelerations in m/s², positions in metres,
  velocities in m/s, `ultrasound` in metres. GPS uses decimal degrees and altitude in metres.
- `battery_percent` is always `null` for now. The robot does not publish battery state.

Shortened example of `GET /api/v1/robots/cerber-lite3-01/telemetry/latest`:

```json
{
  "robot_id": "cerber-lite3-01",
  "ts": 1761487391.0,
  "imu": {"roll": 0.0, "pitch": 0.0, "yaw": 0.2, "angular_velocity": {"x": 0.0, "y": 0.0, "z": 0.05},
          "linear_acceleration": {"x": 0.1, "y": 0.0, "z": 9.81}, "orientation": {"x": 0, "y": 0, "z": 0.0998, "w": 0.995}},
  "imu_at": 1761487390.996,
  "joints": {"names": ["LF_Joint", "LF_Joint_1", "LF_Joint_2", "..."], "position": [0.0, -0.8, 1.6, "..."]},
  "odometry": {"position": {"x": 12.4, "y": -3.1, "z": 0.33}, "yaw": 0.2, "velocity_body": {"x": 0.5, "y": 0.0, "z": 0.0}, "yaw_rate": 0.05},
  "gps": {"time": "2026-10-26T14:03:11Z", "latitude": 51.107885, "longitude": 17.038538, "altitude": 118.4, "satellites": 9, "fix_quality": 1},
  "status": {"online": true, "last_seen": 1761487390.996, "rosbridge_connected": true, "mqtt_connected": true}
}
```

The package has full examples of every type in `examples/` and the schemas in `schemas/`.

### Errors

| Code | When |
|---|---|
| 401 | missing or wrong key |
| 404 | unknown `robot_id`, or `/gps/latest` before the first position arrives |
| 502 | the gateway is down and the reverse proxy answers. Retry after a moment. |

Error body: `{"detail": "..."}` (schema `Error`).

## 3. Robot telemetry: WebSocket

```
wss://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key=<key>
```

The server sends only text JSON frames, wrapped in a `TelemetryEventEnvelope`:

```json
{"event": {"type": "gps", "robot_id": "cerber-lite3-01", "ts": 1761487391.0, "data": {"latitude": 51.107885, "longitude": 17.038538, "...": "..."}}}
```

| `type` | `data` | Notes |
|---|---|---|
| `snapshot` | `TelemetrySnapshot` | always the first frame after connecting |
| `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps`, `sensors_alive` | matching model | at most **1 frame per second per type**. The last value in each window wins, so the final state always arrives. |
| `status` | `RobotStatus` | sent at once when `online`, `rosbridge_connected` or `mqtt_connected` changes, and as a heartbeat **every 5 s** |

You do not need to send anything. The server ignores client frames. The limit is 4096 B, and a larger frame
closes the connection with `1009`. If no frame arrives for more than ~15 s, the connection is dead. Reconnect.

Close codes:

| Code | Meaning | What to do |
|---|---|---|
| 4401 | wrong key | fix the key, do not retry in a loop |
| 4404 | unknown `robot_id` | check `/api/v1/robots` |
| 1013 | limit of 20 concurrent connections per robot | retry after a few seconds, share one connection in your application |
| 1011 | client did not answer the WS ping (sent every 20 s) | your WS library must answer pings automatically. Standard libraries do. |
| 1006 / 1008 | client did not read fast enough | read frames as they arrive, do not block the receive loop |

Retry with exponential backoff from 1 s to 30 s. Do not open several connections per user. Open one connection
per application and distribute the events internally.

Minimal client (Python, `pip install websockets`):

```python
import asyncio, json, os, websockets

URL = f"wss://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key={os.environ['CERBER_KEY']}"

async def main():
    async with websockets.connect(URL) as ws:
        async for raw in ws:
            ev = json.loads(raw)["event"]
            print(ev["type"], ev["ts"], ev["data"] if ev["type"] != "snapshot" else "(snapshot)")

asyncio.run(main())
```

In a browser, use `new WebSocket(url)` and read `JSON.parse(e.data).event` in `onmessage`. The key in the WS
URL is visible in the browser developer tools. A public application should therefore keep the WS connection
on its backend and send its own stream to the browser.

## 4. Camera video: WebRTC (WHEP)

Playback is public and needs no key. Each camera is a MediaMTX path under `/video/`:

| Path | Source | Availability |
|---|---|---|
| `video/normal_cam` | robot RGB camera | while the robot streams |
| `video/IR_cam` | robot thermal camera | while the robot streams |
| `video/dji01` | DJI Mavic 3M drone | while the operator streams |
| `video/normal_cam/demo` | test pattern or looped recording | always |
| `video/dji01/demo` | test pattern or looped recording | always |

There are two ways to play a stream:

1. **Built-in player** for a quick preview, also inside an `<iframe>`: `https://cerber.machinekind.ai/video/dji01/demo/`
2. **WHEP** in your own application: `POST https://cerber.machinekind.ai/video/<path>/whep`
   - Request: `Content-Type: application/sdp`, with the SDP offer (`recvonly`) as the body.
   - Response `201`: the body is the SDP answer. The `Location` header is the session URL.
   - End the session with `DELETE <Location>`. Otherwise it expires after a dozen or so seconds without traffic.
   - `404` means nobody is streaming on this path. Retry with backoff from 2 s to 30 s, never every second.

```js
async function playWhep(video, path) {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => { video.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(`https://cerber.machinekind.ai/${path}/whep`, {
    method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp,
  });
  if (res.status === 404) throw new Error("no stream");           // nobody is streaming
  const session = new URL(res.headers.get("Location"), res.url);  // for DELETE on close
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return () => { fetch(session, { method: "DELETE", keepalive: true }); pc.close(); };
}
playWhep(document.querySelector("video"), "video/dji01/demo");
```

Client network requirements: besides HTTPS on 443, media goes over **UDP or TCP to port 18189** on the server.
It goes straight to the server's public IP address from the ICE candidates and bypasses HTTP proxies. You do
not need STUN or TURN. Corporate networks that block outbound UDP work over TCP, with slightly higher latency.

Format: H.264. Browsers get no audio, because the drone sends AAC and WebRTC does not carry it. Recording,
HLS and RTSP are not publicly available.

`GET /api/v1/robots/{robot_id}/streams` returns the same WHEP URLs for the robot cameras, so your application
does not have to hard-code them. `whep_url` is relative to the API host. The `vpn_only` field is a
configuration flag and does not reflect network state. It is currently `false`.

## 5. Publishing video (for source providers)

### DJI drone: RTMP from the internet

| | |
|---|---|
| URL | `rtmp://cerber.machinekind.ai:1935/video/dji01?user=<login>&pass=<password>` |
| apps with two fields (DJI Fly / Pilot, OBS) | URL `rtmp://cerber.machinekind.ai:1935/video`, stream key `dji01?user=<login>&pass=<password>` |
| codec | H.264, keyframe interval ≤ 2 s, no B-frames. Set the bitrate to fit the LTE link. |
| audio | accepted, but does not reach the browser |

We send the login and password separately. One publisher can stream at a time, and a second publisher on the
same path is rejected. RTMPS is not configured yet. To test without a drone, run this on any machine with ffmpeg:

```bash
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 60 -pix_fmt yuv420p -b:v 2000k -an -f flv "rtmp://cerber.machinekind.ai:1935/video/dji01?user=$U&pass=$P"
```

### Robot: VPN only

The robot and the server are on one VPN network (NetBird). The addresses below are not reachable from the
internet. We send the server's VPN address (`<SERVER_VPN_ADDR>`) and the network invitation separately.

| What | Where to | Format |
|---|---|---|
| cameras | `srt://<SERVER_VPN_ADDR>:18890?streamid=publish:video/normal_cam&pkt_size=1316` (same for `video/IR_cam`) | MPEG-TS/H.264 over SRT, no password |
| GPS | MQTT `<SERVER_VPN_ADDR>:11883`, topic `cerber/gps/data` | JSON: `latitude`, `longitude` (degrees), `date` (ISO 8601 UTC), optional `altitude`, `satellites`, `fix_quality` |
| ROS 2 telemetry | the robot exposes rosbridge (WebSocket, port 9090) in the VPN. The gateway connects to it. | topics: `/imu/data`, `/joint_states`, `/leg_odom2`, `/us_publisher/ultrasound_distance`, `/ptz/status`, `/sensor_status/*_isalive` |

## 6. Contract and package

Contents of `cerber-public-api-<date>.zip`:

| File | Contents |
|---|---|
| `README.md` | this document |
| `openapi.json` | the gateway's OpenAPI 3.1 with a `servers` field. The WS stream is described in the `x-websockets` extension, because OpenAPI cannot describe WS natively. |
| `schemas/*.json` | JSON Schema (draft 2020-12) for each model, for validation in your CI |
| `examples/*.json` | sample REST responses and WS frames, validated against the schemas |

The same files are live at `https://cerber.machinekind.ai/openapi.json` (contract) and
`https://cerber.machinekind.ai/docs` (Swagger UI). In Swagger UI the *Authorize* button lets you send requests
with your key. Generate a client with, for example, `openapi-generator-cli generate -i openapi.json -g typescript-fetch -o client/`.

The video contract (WHEP) is an IETF standard (draft-ietf-wish-whep) as implemented by MediaMTX. It is not
part of `openapi.json`.

## 7. Limits and good practice

- REST: polling `/telemetry/latest` more than once per second gains nothing. The data does not change faster
  than the WS throttling allows. Use WS for live data.
- WS: 20 connections per robot, shared by all integrations. Use one connection per application.
- WHEP: each viewer is a separate WebRTC session on the server. Tell us in advance about demos with many viewers.
- Availability: there is no SLA. This is a demo environment. `/health` shows the server state, and `online`
  shows the robot state. We announce planned downtime in advance.

## 8. Contact and issue reports

Report issues through the channel agreed when we handed over the key. Include the URL, the time in UTC, the
response code or WS close code and, if possible, part of the response body. Never paste the key or passwords.
