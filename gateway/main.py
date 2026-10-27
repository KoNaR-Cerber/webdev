"""
Cerber Telemetry Gateway - publiczne, read-only API nad robotem Lite3.

Stoi w sieci VPN: czyta rosbridge (ws://JETSON:9090) i MQTT
(cerber/gps/data), skleja z tego TelemetrySnapshot i wystawia:

  GET  /health
  GET  /api/v1/robots
  GET  /api/v1/robots/{robot_id}
  GET  /api/v1/robots/{robot_id}/telemetry/latest
  GET  /api/v1/robots/{robot_id}/gps/latest
  GET  /api/v1/robots/{robot_id}/streams
  WS   /api/v1/robots/{robot_id}/telemetry/stream?api_key=...
  GET  /openapi.json, /docs

Zadnego sterowania - komendy zostaja za VPN. Autoryzacja: naglowek X-API-Key
(REST) lub query `api_key` (WebSocket). Konfiguracja przez zmienne srodowiskowe.

Uruchomienie:  uvicorn main:app --host 0.0.0.0 --port 8000
Zaleznosci:    fastapi uvicorn pydantic roslibpy aiomqtt
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Set

from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from contracts import (
    API_VERSION, Error, GPSFix, GpsEvent, Health, Imu, ImuEvent, Joints, JointsEvent,
    Odometry, OdometryEvent, PingEvent, Ptz, PtzEvent, PtzState, Quaternion, RobotList, RobotSummary,
    SensorsAlive, SensorsAliveEvent, SnapshotEvent, TelemetryEventEnvelope,
    TelemetrySnapshot, UltrasoundEvent, Vec3, VideoStream, VideoStreamList,
)

# --- konfiguracja ----------------------------------------------------------

ROBOT_ID = os.getenv("ROBOT_ID", "cerber-lite3-01")
ROBOT_MODEL = os.getenv("ROBOT_MODEL", "DEEP Robotics Lite3 Venture")
API_KEY = os.getenv("API_KEY", "")  # wymagany: bez niego aplikacja nie wystartuje (lifespan)
ROSBRIDGE_HOST = os.getenv("ROSBRIDGE_HOST", "10.13.13.2")
ROSBRIDGE_PORT = int(os.getenv("ROSBRIDGE_PORT", "9090"))
MQTT_HOST = os.getenv("MQTT_HOST", "10.13.13.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_GPS_TOPIC = os.getenv("MQTT_GPS_TOPIC", "cerber/gps/data")
MEDIAMTX_BASE = os.getenv("MEDIAMTX_BASE", "https://10.13.13.1/video")
STALE_AFTER_S = float(os.getenv("STALE_AFTER_S", "5"))
IMU_MAX_HZ = float(os.getenv("IMU_MAX_HZ", "10"))  # throttling ramek WS dla szybkich topikow
STREAMS_VPN_ONLY = os.getenv("STREAMS_VPN_ONLY", "1") == "1"
ROSBRIDGE_ENABLED = os.getenv("ROSBRIDGE_ENABLED", "1") == "1"
MQTT_ENABLED = os.getenv("MQTT_ENABLED", "1") == "1"

ROS_SUBSCRIPTIONS = {
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
SENSOR_ALIVE_KEYS = {
    "/sensor_status/imu_isalive": "imu",
    "/sensor_status/odom2_isalive": "odom",
    "/sensor_status/joint_isalive": "joints",
    "/sensor_status/realsense_isalive": "realsense",
    "/sensor_status/lidar_isalive": "lidar",
    "/sensor_status/ultrasound_isalive": "ultrasound",
}
VIDEO_STREAMS = [("normal_cam", "video/normal_cam"), ("IR_cam", "video/IR_cam")]


# --- konwersja ROS -> model publiczny --------------------------------------


def quat_to_rpy(q: Dict[str, float]) -> tuple[float, float, float]:
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    roll = math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    s = max(-1.0, min(1.0, 2 * (w * y - z * x)))
    pitch = math.asin(s)
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return roll, pitch, yaw


def imu_from_ros(m: Dict[str, Any]) -> Imu:
    r, p, y = quat_to_rpy(m["orientation"])
    return Imu(
        orientation=Quaternion(**m["orientation"]), roll=r, pitch=p, yaw=y,
        angular_velocity=Vec3(**m["angular_velocity"]),
        linear_acceleration=Vec3(**m["linear_acceleration"]),
    )


def joints_from_ros(m: Dict[str, Any]) -> Joints:
    return Joints(names=list(m["name"]), position=[float(v) for v in m["position"]])


def odom_from_ros(m: Dict[str, Any]) -> Odometry:
    pose = m["pose"]["pose"]
    tw = m["twist"]["twist"]
    _, _, yaw = quat_to_rpy(pose["orientation"])
    return Odometry(
        position=Vec3(**pose["position"]), yaw=yaw,
        velocity_body=Vec3(x=tw["linear"]["x"], y=tw["linear"]["y"], z=0.0),
        yaw_rate=tw["angular"]["z"],
    )


def ptz_from_ros(m: Dict[str, Any]) -> Ptz:
    # format: "[PTZ] WAITING | IP: ..." - IP glowicy celowo nie trafia do publicznego API
    raw = m.get("data", "")
    state = raw.partition("|")[0].replace("[PTZ]", "").strip()
    try:
        return Ptz(state=PtzState(state))
    except ValueError:
        return Ptz(state=PtzState.UNKNOWN)


def gps_from_mqtt(m: Dict[str, Any]) -> GPSFix:
    return GPSFix(
        time=m.get("date"), latitude=m["latitude"], longitude=m["longitude"],
        altitude=m.get("altitude", 0.0), satellites=m.get("satellites", 0),
        fix_quality=m.get("fix_quality", 0),
    )


# --- stan + rozglaszanie ---------------------------------------------------


class RobotState:
    def __init__(self, robot_id: str):
        self.snapshot = TelemetrySnapshot(robot_id=robot_id, ts=time.time())
        self.last_seen: Optional[float] = None
        self.clients: Set[WebSocket] = set()
        self._last_sent: Dict[str, float] = {}

    def online(self) -> bool:
        return self.last_seen is not None and time.time() - self.last_seen < STALE_AFTER_S

    def summary(self) -> RobotSummary:
        return RobotSummary(robot_id=self.snapshot.robot_id, model=ROBOT_MODEL,
                            online=self.online(), last_seen=self.last_seen)

    async def apply(self, event) -> None:
        """Wprowadza zdarzenie do snapshotu i rozsyla je klientom WS."""
        now = event.ts
        self.last_seen = now
        s = self.snapshot
        s.ts = now
        kind = event.type
        if kind == "imu":
            s.imu, s.imu_at = event.data, now
        elif kind == "joints":
            s.joints, s.joints_at = event.data, now
        elif kind == "odometry":
            s.odometry, s.odometry_at = event.data, now
        elif kind == "ultrasound":
            s.ultrasound, s.ultrasound_at = event.data, now
        elif kind == "ptz":
            s.ptz, s.ptz_at = event.data, now
        elif kind == "gps":
            s.gps, s.gps_at = event.data, now
        elif kind == "sensors_alive":
            s.sensors_alive = event.data

        # throttling: szybkie topiki (IMU ~200 Hz, joints, odom, ultrasound z tego samego pakietu co odom) nie zalewaja WS
        if kind in ("imu", "joints", "odometry", "ultrasound") and IMU_MAX_HZ > 0:
            last = self._last_sent.get(kind, 0.0)
            if now - last < 1.0 / IMU_MAX_HZ:
                return
            self._last_sent[kind] = now
        await self.broadcast(event)

    async def broadcast(self, event) -> None:
        if not self.clients:
            return
        text = TelemetryEventEnvelope(event=event).model_dump_json()
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


robots: Dict[str, RobotState] = {ROBOT_ID: RobotState(ROBOT_ID)}
ros_client = None  # roslibpy.Ros; stan polaczenia czytamy z ros_client.is_connected
mqtt_connected = False


def rosbridge_is_connected() -> bool:
    return bool(ros_client is not None and getattr(ros_client, "is_connected", False))


def get_robot(robot_id: str) -> RobotState:
    r = robots.get(robot_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown robot_id: {robot_id}")
    return r


# --- zrodla: rosbridge (watek) i MQTT (asyncio) -----------------------------


def start_rosbridge(loop: asyncio.AbstractEventLoop, robot: RobotState):
    """roslibpy (Twisted) startuje reactor we wlasnym watku daemon (ros.run(), bez
    instalacji sygnalow); callbacki wrzucaja zdarzenia do petli asyncio."""
    global ros_client
    import roslibpy

    ros = roslibpy.Ros(host=ROSBRIDGE_HOST, port=ROSBRIDGE_PORT)
    ros_client = ros
    alive_state = SensorsAlive()

    def push(event):
        asyncio.run_coroutine_threadsafe(robot.apply(event), loop)

    def handler(topic: str):
        def cb(msg: Dict[str, Any]):
            now = time.time()
            try:
                if topic == "/imu/data":
                    push(ImuEvent(robot_id=robot.snapshot.robot_id, ts=now, data=imu_from_ros(msg)))
                elif topic == "/joint_states":
                    push(JointsEvent(robot_id=robot.snapshot.robot_id, ts=now, data=joints_from_ros(msg)))
                elif topic == "/leg_odom2":
                    push(OdometryEvent(robot_id=robot.snapshot.robot_id, ts=now, data=odom_from_ros(msg)))
                elif topic == "/us_publisher/ultrasound_distance":
                    push(UltrasoundEvent(robot_id=robot.snapshot.robot_id, ts=now, data=float(msg["data"])))
                elif topic == "/ptz/status":
                    push(PtzEvent(robot_id=robot.snapshot.robot_id, ts=now, data=ptz_from_ros(msg)))
                elif topic in SENSOR_ALIVE_KEYS:
                    setattr(alive_state, SENSOR_ALIVE_KEYS[topic], bool(msg["data"]))
                    push(SensorsAliveEvent(robot_id=robot.snapshot.robot_id, ts=now,
                                           data=alive_state.model_copy()))
            except Exception as ex:  # zla wiadomosc nie moze zabic subskrypcji
                print(f"[rosbridge] {topic}: {ex!r}")
        return cb

    def on_ready():
        # Topic(reconnect_on_close=True) sam sie re-subskrybuje po reconnect; on_ready odpala sie raz
        for t, mtype in ROS_SUBSCRIPTIONS.items():
            roslibpy.Topic(ros, t, mtype, reconnect_on_close=True).subscribe(handler(t))
        print(f"[rosbridge] connected to {ROSBRIDGE_HOST}:{ROSBRIDGE_PORT}, {len(ROS_SUBSCRIPTIONS)} topics")

    def on_close(*_):
        print("[rosbridge] connection closed, roslibpy will reconnect")

    ros.on_ready(on_ready)
    ros.on("close", on_close)
    ros.run()  # nieblokujace: reactor w watku daemon, bez signal handlers
    return ros


async def mqtt_task(robot: RobotState) -> None:
    global mqtt_connected
    import aiomqtt

    while True:
        try:
            async with aiomqtt.Client(MQTT_HOST, MQTT_PORT) as client:
                mqtt_connected = True
                await client.subscribe(MQTT_GPS_TOPIC)
                async for msg in client.messages:
                    try:
                        data = json.loads(msg.payload.decode())
                        await robot.apply(GpsEvent(robot_id=robot.snapshot.robot_id, ts=time.time(),
                                                   data=gps_from_mqtt(data)))
                    except Exception as ex:
                        print(f"[mqtt] bad GPS payload: {ex!r}")
        except asyncio.CancelledError:
            raise
        except Exception as ex:
            mqtt_connected = False
            print(f"[mqtt] {ex!r}; reconnect in 3 s")
            await asyncio.sleep(3)


# --- aplikacja -------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_KEY:
        raise RuntimeError("API_KEY is not set; refusing to start a public API without a key")
    loop = asyncio.get_running_loop()
    robot = robots[ROBOT_ID]
    tasks = []
    ros = start_rosbridge(loop, robot) if ROSBRIDGE_ENABLED else None
    if MQTT_ENABLED:
        tasks.append(asyncio.create_task(mqtt_task(robot)))
    yield
    for t in tasks:
        t.cancel()
    if ros is not None:
        try:
            ros.terminate()
        except Exception:
            pass


app = FastAPI(
    title="Cerber Telemetry Gateway",
    version=API_VERSION,
    description=(
        "Publiczne, read-only API telemetrii robota Cerber (DEEP Robotics Lite3). "
        "Dane pochodza z ROS 2 (rosbridge) i MQTT po stronie VPN. Sterowanie robotem "
        "nie jest wystawione. Autoryzacja: naglowek `X-API-Key` (REST) lub query `api_key` (WebSocket)."
    ),
    lifespan=lifespan,
)


def key_ok(key: str) -> bool:
    # porownanie w stalym czasie; pusty API_KEY nigdy nie przepuszcza
    return bool(API_KEY) and secrets.compare_digest(key.encode(), API_KEY.encode())


def require_key(x_api_key: str = Header(default="", alias="X-API-Key")) -> None:
    if not key_ok(x_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


COMMON_ERRORS = {401: {"model": Error}, 404: {"model": Error}}


@app.get("/health", response_model=Health, tags=["system"])
async def health() -> Health:
    rb = rosbridge_is_connected()
    ok = (rb or not ROSBRIDGE_ENABLED) and (mqtt_connected or not MQTT_ENABLED)
    return Health(status="ok" if ok else "degraded", rosbridge_connected=rb,
                  mqtt_connected=mqtt_connected, ts=time.time())


@app.get("/api/v1/robots", response_model=RobotList, tags=["robots"],
         dependencies=[Depends(require_key)], responses=COMMON_ERRORS)
async def list_robots() -> RobotList:
    return RobotList(robots=[r.summary() for r in robots.values()])


@app.get("/api/v1/robots/{robot_id}", response_model=RobotSummary, tags=["robots"],
         dependencies=[Depends(require_key)], responses=COMMON_ERRORS)
async def get_robot_summary(robot_id: str) -> RobotSummary:
    return get_robot(robot_id).summary()


@app.get("/api/v1/robots/{robot_id}/telemetry/latest", response_model=TelemetrySnapshot,
         tags=["telemetry"], dependencies=[Depends(require_key)], responses=COMMON_ERRORS,
         summary="Ostatni znany stan robota (wszystkie sekcje)")
async def telemetry_latest(robot_id: str) -> TelemetrySnapshot:
    return get_robot(robot_id).snapshot


@app.get("/api/v1/robots/{robot_id}/gps/latest", response_model=GPSFix, tags=["telemetry"],
         dependencies=[Depends(require_key)], responses=COMMON_ERRORS)
async def gps_latest(robot_id: str) -> GPSFix:
    gps = get_robot(robot_id).snapshot.gps
    if gps is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No GPS fix received yet")
    return gps


@app.get("/api/v1/robots/{robot_id}/streams", response_model=VideoStreamList, tags=["video"],
         dependencies=[Depends(require_key)], responses=COMMON_ERRORS,
         summary="Strumienie wideo (WHEP, tylko z VPN)")
async def streams(robot_id: str) -> VideoStreamList:
    get_robot(robot_id)
    return VideoStreamList(streams=[
        VideoStream(name=n, path=p, whep_url=f"{MEDIAMTX_BASE}/{n}/whep", vpn_only=STREAMS_VPN_ONLY)
        for n, p in VIDEO_STREAMS
    ])


@app.websocket("/api/v1/robots/{robot_id}/telemetry/stream")
async def telemetry_stream(ws: WebSocket, robot_id: str, api_key: str = Query(default="")):
    """Strumien zdarzen TelemetryEventEnvelope. Pierwsza ramka = `snapshot`, potem
    zdarzenia per zrodlo (IMU/joints/odometry/ultrasound z throttlingiem do IMU_MAX_HZ).
    Ramki od klienta (tekst i binarne) sa ignorowane. Po 20 s bez ruchu od klienta
    serwer wysyla ramke `ping` (w schemacie envelope); klient nie musi odpowiadac.
    Zly klucz -> zamkniecie kodem 4401, nieznany robot_id -> 4404 (po accept, wiec
    klient dostaje kod)."""
    await ws.accept()
    if not key_ok(api_key):
        await ws.close(code=4401, reason="invalid api key")
        return
    robot = robots.get(robot_id)
    if robot is None:
        await ws.close(code=4404, reason="unknown robot_id")
        return
    robot.clients.add(ws)
    try:
        first = SnapshotEvent(robot_id=robot_id, ts=time.time(), data=robot.snapshot)
        await ws.send_text(TelemetryEventEnvelope(event=first).model_dump_json())
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=20)
                if msg.get("type") == "websocket.disconnect":
                    break
            except asyncio.TimeoutError:
                ping = PingEvent(ts=time.time())
                await ws.send_text(TelemetryEventEnvelope(event=ping).model_dump_json())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        robot.clients.discard(ws)


# Opis WS w OpenAPI (OpenAPI 3.1 nie ma WS; dokumentujemy jako schemat + x-websocket)
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = FastAPI.openapi(app)
    schema["components"]["schemas"].update({
        "TelemetryEventEnvelope": TelemetryEventEnvelope.model_json_schema(
            ref_template="#/components/schemas/{model}"
        )
    })
    env = schema["components"]["schemas"]["TelemetryEventEnvelope"]
    for name, sub in env.pop("$defs", {}).items():
        schema["components"]["schemas"].setdefault(name, sub)
    schema["x-websockets"] = {
        "/api/v1/robots/{robot_id}/telemetry/stream": {
            "description": telemetry_stream.__doc__.strip(),
            "query": {"api_key": "string, wymagany"},
            "closeCodes": {"4401": "zly klucz (po accept)", "4404": "nieznany robot_id (po accept)"},
            "message": {"$ref": "#/components/schemas/TelemetryEventEnvelope"},
            "keepalive": {"event": {"type": "ping", "ts": "epoch [s]"}, "after_idle_s": 20},
        }
    }
    schema["components"]["securitySchemes"] = {
        "ApiKey": {"type": "apiKey", "in": "header", "name": "X-API-Key"}
    }
    for path, ops in schema["paths"].items():
        if path.startswith("/api/"):
            for op in ops.values():
                op["security"] = [{"ApiKey": []}]
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi  # type: ignore[method-assign]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
