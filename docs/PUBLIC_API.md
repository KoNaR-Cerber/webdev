# Cerber public API for the robot and the drone
Robot telemetry uses REST and WebSocket. Robot and drone camera video uses WebRTC. All services use `cerber.machinekind.ai`. The API key is supplied separately.

| Resource | URL |
|---|---|
| OpenAPI contract | https://cerber.machinekind.ai/openapi.json |
| Swagger UI | https://cerber.machinekind.ai/docs |
| Health | https://cerber.machinekind.ai/health |
| Demo stream, drone | https://cerber.machinekind.ai/video/dji01/demo/ |
| Demo stream, robot camera | https://cerber.machinekind.ai/video/normal_cam/demo/ |

```
                        https://cerber.machinekind.ai
  /health, /api/v1/robots/*  ──► telemetry gateway (REST, WS; API key)
  /video/<path>/whep         ──► MediaMTX (WebRTC/WHEP; no key)
  /docs, /openapi.json       ──► interactive docs and OpenAPI 3.1 contract
```

Rules:
- The API is read-only. It exposes no robot or drone controls. Telemetry requires an API key. Camera video is public and requires no key.
- The dashboard at `/` requires the project VPN. Public services are the telemetry API, `/docs`, `/openapi.json` and `/video/*`.
- This is a staging environment for demos. The robot is online only during tests and demos. The `*/demo` streams always run.
- The contract, JSON schemas and examples are generated from the code and versioned with it.

## 1. API key

| Where | How |
|---|---|
| REST | header `X-API-Key: <key>` |
| WebSocket | query parameter `?api_key=<key>`; browsers cannot set the header |

A wrong or missing key returns `401 {"detail": "..."}` on REST. On WS, the server accepts the connection and immediately closes it with `4401`. Keep the key out of repositories, logs and public chats. Leaked keys are rotated and replacements supplied. Do not put the key in REST query strings.

## 2. Robot telemetry: REST
Base URL: `https://cerber.machinekind.ai`. Robot ID: `cerber-lite3-01`. `/api/v1/robots` lists all robots.

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `Health` with the gateway state and its connections to the robot. No key needed. |
| GET | `/api/v1/robots` | `RobotList` |
| GET | `/api/v1/robots/{robot_id}` | `RobotSummary`: `online`, `last_seen` |
| GET | `/api/v1/robots/{robot_id}/telemetry/latest` | `TelemetrySnapshot` with the last known state of every source |
| GET | `/api/v1/robots/{robot_id}/gps/latest` | `GPSFix`, or `404` if no position has arrived yet |
| GET | `/api/v1/robots/{robot_id}/streams` | `VideoStreamList` with the WHEP URLs of the robot cameras |
```bash
export CERBER_KEY=...   # from the separate channel
curl -s https://cerber.machinekind.ai/health
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.machinekind.ai/api/v1/robots
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/telemetry/latest
```

Check `/health` before requesting data. `/health` shows the server state, `online` shows the robot state.

```json
{"status": "degraded", "version": "1.0.0", "rosbridge_connected": false, "mqtt_connected": true, "ts": 1793605324.49}
```

`status` is `ok` when both sources are connected and `degraded` otherwise. `degraded` with `rosbridge_connected: false` means the robot is off or outside the VPN. The API still responds. ROS data stops updating.

### Field meanings

| Field or data | Meaning |
|---|---|
| `online` | The robot has an open gateway connection and sent something in the last 5 s. |
| `last_seen` | Time of the last robot message, in epoch seconds as a float. |
| `TelemetrySnapshot` | Sections: `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps`, `sensors_alive`. Each has a receive time `*_at`. Each stays `null` until its data arrives after gateway startup. `status` is computed when the response is built. |
| `ts`, `*_at`, `last_seen` | Server receive times (epoch). The robot clock is not used. |
| Units | Angles: radians. Angular velocities: rad/s. Accelerations: m/s². Positions: metres. Velocities: m/s. `ultrasound`: metres. GPS: decimal degrees; altitude: metres. |
| `battery_percent` | Currently always `null`. The robot does not publish battery state. |

Shortened `GET /api/v1/robots/cerber-lite3-01/telemetry/latest` example:

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

### Errors

| Code | When |
|---|---|
| 401 | Missing or wrong key. |
| 404 | Unknown `robot_id`, or `/gps/latest` before the first position arrives. |
| 502 | The gateway is down and the reverse proxy answers. Retry after a moment. |

Error body: `{"detail": "..."}`. Schema: `Error`.

## 3. Robot telemetry: WebSocket

```
wss://cerber.machinekind.ai/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key=<key>
```

The server sends only text JSON frames wrapped in a `TelemetryEventEnvelope`:

```json
{"event": {"type": "gps", "robot_id": "cerber-lite3-01", "ts": 1761487391.0, "data": {"latitude": 51.107885, "longitude": 17.038538, "...": "..."}}}
```

| `type` | `data` | Notes |
|---|---|---|
| `snapshot` | `TelemetrySnapshot` | Always the first frame after connecting. |
| `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps`, `sensors_alive` | matching model | At most **1 frame per second per type**. The last value in each window is delivered. |
| `status` | `RobotStatus` | Sent immediately when `online`, `rosbridge_connected` or `mqtt_connected` changes, and as a heartbeat **every 5 s**. |

No client frames are required. The server ignores them. The client frame limit is 4096 B. Larger frames close the connection with `1009`. Treat the connection as dead if no frame arrives for more than ~15 s. Reconnect.

| Close code | Meaning | Action |
|---|---|---|
| 4401 | Wrong key. | Fix the key. Do not retry in a loop. |
| 4404 | Unknown `robot_id`. | Check `/api/v1/robots`. |
| 1013 | Limit of 20 concurrent connections per robot. | Retry after a few seconds. Share one connection in your application. |
| 1011 | Client did not answer the WS ping sent every 20 s. | Use a WS library that answers pings automatically. Standard libraries do. |
| 1006 / 1008 | Client did not read fast enough. | Read frames as they arrive. Do not block the receive loop. |

Retry with exponential backoff from 1 s to 30 s. Do not open several connections per user. Open one connection per application and distribute events internally.

Install `websockets` with `pip install websockets`. Minimal Python client:

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

In a browser, use `new WebSocket(url)`. Read `JSON.parse(e.data).event` in `onmessage`. The WS URL key is visible in browser developer tools. For public applications, keep the WS connection on the backend and send your own stream to the browser.

## 4. Camera video: WebRTC (WHEP)
Playback is public and requires no key. Each camera is a MediaMTX path under `/video/`:

| Path | Source | Availability |
|---|---|---|
| `video/normal_cam` | robot RGB camera | while the robot streams |
| `video/IR_cam` | robot thermal camera | while the robot streams |
| `video/dji01` | DJI Mavic 3M drone | while the operator streams |
| `video/normal_cam/demo` | test pattern or looped recording | always |
| `video/dji01/demo` | test pattern or looped recording | always |

Use the built-in player at `https://cerber.machinekind.ai/video/dji01/demo/`, including inside an `<iframe>`. For WHEP playback in your application, send `POST https://cerber.machinekind.ai/video/<path>/whep` with `Content-Type: application/sdp` and the SDP offer (`recvonly`) as the body. Response `201` has the SDP answer in its body. The `Location` header is the session URL. End the session with `DELETE <Location>`. Sessions expire after a dozen or so seconds without traffic. `404` means nobody is streaming on the path. Retry with backoff from 2 s to 30 s. Do not retry every second.

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

Allow HTTPS on port 443 and media over UDP or TCP to port 18189 on the server. Media connects directly to the server's public IP address from ICE candidates and bypasses HTTP proxies. STUN and TURN are not required. Networks that block outbound UDP use TCP with slightly higher latency. Each WHEP viewer uses a separate WebRTC session on the server.

Video format: H.264. Browsers receive no audio. The drone sends AAC. WebRTC does not carry it. Recording, HLS and RTSP are not publicly available.

`GET /api/v1/robots/{robot_id}/streams` returns the same WHEP URLs for robot cameras. `whep_url` is relative to the API host. `vpn_only` is a configuration flag and does not reflect network state. It is currently `false`.

## 5. Drone video publishing (RTMP)

| Setting | Value |
|---|---|
| URL | `rtmp://cerber.machinekind.ai:1935/video/dji01?user=<login>&pass=<password>` |
| Apps with two fields: DJI Fly / Pilot, OBS | URL `rtmp://cerber.machinekind.ai:1935/video`, stream key `dji01?user=<login>&pass=<password>` |
| Codec | H.264, keyframe interval ≤ 2 s, no B-frames. Set the bitrate to fit the LTE link. |
| Audio | Accepted. Does not reach the browser. |

Login and password are supplied separately. One publisher can stream at a time. A second publisher on the same path is rejected. RTMPS is not configured yet. Test without a drone on any machine with ffmpeg:

```bash
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 60 -pix_fmt yuv420p -b:v 2000k -an -f flv "rtmp://cerber.machinekind.ai:1935/video/dji01?user=$U&pass=$P"
```

## 6. Contract and package
Contents of `cerber-public-api-<date>.zip`:

| File | Contents |
|---|---|
| `README.md` | This document. |
| `openapi.json` | Gateway OpenAPI 3.1 with a `servers` field. WS is described in `x-websockets`. OpenAPI cannot describe WS natively. |
| `schemas/*.json` | JSON Schema draft 2020-12 for each model. Use for CI validation. |
| `examples/*.json` | Full examples of every type: sample REST responses and WS frames, validated against the schemas. |

Live contract: `https://cerber.machinekind.ai/openapi.json`. Swagger UI: `https://cerber.machinekind.ai/docs`. Use the Authorize button to send requests with your key. Generate a client with `openapi-generator-cli generate -i openapi.json -g typescript-fetch -o client/`.

The WHEP video contract is IETF standard `draft-ietf-wish-whep` as implemented by MediaMTX. It is not part of `openapi.json`.

## 7. Limits

| Service | Limit |
|---|---|
| REST | Poll `/telemetry/latest` at most once per second. Use WS for live data. |
| WS | 20 connections per robot, shared by all integrations. |
| Availability | No SLA. |
## 8. Contact and issue reports
Report issues through the channel agreed at key handover; include the URL, time in UTC, response code or WS close code and, if possible, part of the response body. Never paste the key or passwords.
