"""Robot demo: nagranie NDJSON (koperty WS) odtwarzane w petli z czasami "teraz" i robot_id demo; zmiana
wskaznika przeladowuje nagranie bez restartu, brak wskaznika = offline; kamery pod */demo."""

import asyncio
import json
import time

import contracts as c
import main
from test_status import Rec


def envelope(kind, ts, data):
    return json.dumps({"event": {"type": kind, "robot_id": "cerber-lite3-01", "ts": ts, "data": data}})


IMU = {"orientation": {"x": 0, "y": 0, "z": 0, "w": 1}, "roll": 0, "pitch": 0, "yaw": 0,
       "angular_velocity": {"x": 0, "y": 0, "z": 0}, "linear_acceleration": {"x": 0, "y": 0, "z": 9.8}}
JOINTS = {"names": [f"J{i}" for i in range(12)], "position": [0.5] * 12}
STATUS = {"online": True, "last_seen": 100.0, "rosbridge_connected": True, "mqtt_connected": True}


def write_recording(path, t0=100.0, step=0.05):
    path.write_text("\n".join([
        json.dumps({"event": {"type": "snapshot", "robot_id": "cerber-lite3-01", "ts": t0, "data": {"robot_id": "cerber-lite3-01", "ts": t0}}}),
        envelope("imu", t0, IMU),
        "not json",
        envelope("status", t0 + 0.01, STATUS),
        envelope("joints", t0 + step, JOINTS),
        envelope("imu", t0 + 2 * step, IMU),
    ]) + "\n")


def test_load_recording_keeps_data_events_with_relative_times(tmp_path):
    rec = tmp_path / "a.ndjson"
    write_recording(rec)
    loaded = main.load_recording(str(rec))
    assert [(round(rel, 2), ev.type) for rel, ev in loaded] == [(0.0, "imu"), (0.05, "joints"), (0.1, "imu")]
    (tmp_path / "empty.ndjson").write_text("\n")
    assert main.load_recording(str(tmp_path / "empty.ndjson")) == []


def test_demo_task_replays_in_loop_and_follows_pointer(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "WS_THROTTLE_S", 0)
    monkeypatch.setattr(main, "DEMO_POLL_S", 0.05)
    monkeypatch.setattr(main, "DEMO_LOOP_GAP_S", 0.05)
    pointer = tmp_path / "telemetry.path"
    monkeypatch.setattr(main, "DEMO_TELEMETRY_POINTER", str(pointer))
    rec = tmp_path / "a.ndjson"
    write_recording(rec)
    robot = main.DemoRobotState("cerber-demo")
    client = Rec()
    robot.clients.add(client)

    async def run():
        task = asyncio.create_task(main.demo_task(robot))
        await asyncio.sleep(0.2)
        assert client.frames == [] and not robot.online() and robot.summary().online is False
        pointer.write_text(f"{rec}\n")
        await asyncio.sleep(0.7)
        data = [e for _, e in client.frames if e["type"] in ("imu", "joints")]
        assert len(data) >= 6, "at least two passes of the recording"
        assert {e["robot_id"] for e in data} == {"cerber-demo"}
        assert all(abs(e["ts"] - time.time()) < 5 for e in data), "timestamps rewritten to now"
        onlines = [e["data"]["online"] for _, e in client.of("status")]
        assert onlines[0] is False and onlines[-1] is True, "replay on (not yet online), then online with the first event"
        assert robot.online() and robot.snapshot.joints.position == [0.5] * 12
        assert robot.status().rosbridge_connected is True
        n = len(client.frames)
        pointer.write_text("")
        await asyncio.sleep(0.3)
        assert not robot.replaying and robot.online() is False
        assert client.of("status")[-1][1]["data"]["online"] is False
        after = [e for _, e in client.frames[n:] if e["type"] in ("imu", "joints")]
        assert len(after) <= 3, "no new pass after the pointer was cleared"
        # inna sciezka = przeladowanie
        rec2 = tmp_path / "b.ndjson"
        write_recording(rec2, t0=500.0)
        pointer.write_text(f"{rec2}\n")
        await asyncio.sleep(0.4)
        assert robot.replaying
        task.cancel()

    asyncio.run(run())


def test_demo_robot_summary_and_streams_point_at_demo_paths():
    main.robots["cerber-demo"] = main.DemoRobotState("cerber-demo")
    try:
        assert "demo" in main.robots["cerber-demo"].summary().model
        out = asyncio.run(main.streams("cerber-demo"))
        assert [s.path for s in out.streams] == ["video/normal_cam/demo", "video/IR_cam/demo"]
        assert out.streams[0].whep_url.endswith("/video/normal_cam/demo/whep")
        assert out.streams[0].vpn_only is False
        live = asyncio.run(main.streams(main.ROBOT_ID))
        assert live.streams[0].path == "video/normal_cam"
    finally:
        del main.robots["cerber-demo"]


def test_pointers_and_playlist_concatenate_in_order(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DEMO_LOOP_GAP_S", 1.0)
    a, b, missing = tmp_path / "a.ndjson", tmp_path / "b.ndjson", tmp_path / "nope.ndjson"
    write_recording(a, t0=100.0, step=0.5)
    write_recording(b, t0=900.0, step=0.25)
    pointer = tmp_path / "telemetry.path"
    pointer.write_text(f"{a}\n\n{missing}\n{b}\n{a}\n")
    assert main.read_pointers(str(pointer)) == [str(a), str(missing), str(b)], "blank lines and repeats dropped"
    assert main.read_pointers(str(tmp_path / "absent.path")) == []
    key = main._source_key(main.read_pointers(str(pointer)))
    assert [k[0] for k in key] == [str(a), str(b)], "missing file skipped, order kept"
    assert main._source_key([str(missing)]) is None
    events = main.load_playlist([str(a), str(missing), str(b)])
    rels = [rel for rel, _ in events]
    assert rels == [0.0, 0.5, 1.0, 2.0, 2.25, 2.5], "b starts DEMO_LOOP_GAP_S after the last event of a"
    assert [e.type for _, e in events] == ["imu", "joints", "imu"] * 2
    # limit playlisty
    many = "".join(f"{tmp_path}/r{i}.ndjson\n" for i in range(8))
    pointer.write_text(many)
    assert len(main.read_pointers(str(pointer))) == main.DEMO_MAX_PLAYLIST


def test_demo_task_plays_playlist_in_order(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "WS_THROTTLE_S", 0)
    monkeypatch.setattr(main, "DEMO_POLL_S", 0.05)
    monkeypatch.setattr(main, "DEMO_LOOP_GAP_S", 0.05)
    pointer = tmp_path / "telemetry.path"
    monkeypatch.setattr(main, "DEMO_TELEMETRY_POINTER", str(pointer))
    a, b = tmp_path / "a.ndjson", tmp_path / "b.ndjson"
    write_recording(a, t0=100.0, step=0.02)
    b.write_text(envelope("joints", 500.0, {**JOINTS, "position": [0.25] * 12}) + "\n")
    pointer.write_text(f"{a}\n{b}\n")
    robot = main.DemoRobotState("cerber-demo")
    client = Rec()
    robot.clients.add(client)

    async def run():
        task = asyncio.create_task(main.demo_task(robot))
        await asyncio.sleep(0.6)
        task.cancel()
        kinds = [e["type"] for _, e in client.frames if e["type"] in ("imu", "joints")]
        joints = [e["data"]["position"][0] for _, e in client.frames if e["type"] == "joints"]
        assert kinds[:4] == ["imu", "joints", "imu", "joints"], "a (imu, joints, imu) then b (joints)"
        assert joints[:2] == [0.5, 0.25] and len(joints) >= 4, "both recordings, looped"
        assert robot.replaying

    asyncio.run(run())
