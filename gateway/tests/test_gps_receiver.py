"""Stan odbiornika GNSS z MQTT cerber/gps/status: osobny temat -> zdarzenie gps_receiver, sekcja snapshotu
gps_receiver/gps_receiver_at, rozsylane do WS; nie liczy sie jako wiadomosc ROS (last_seen); zle dane odrzucane."""

import time

import pytest
from pydantic import ValidationError

import main

STATUS = b'{"fix":false,"satellites":3,"nmea_alive":true,"published":0}'
FIX = b'{"date":"2026-11-03T10:00:00Z","latitude":51.1,"longitude":17.0,"altitude":118.4,"satellites":9,"fix_quality":1}'


def test_dispatch_by_topic():
    ev = main.mqtt_event("r1", main.MQTT_GPS_STATUS_TOPIC, STATUS)
    assert ev.type == "gps_receiver" and ev.data.satellites == 3 and ev.data.fix is False and ev.data.nmea_alive
    ev = main.mqtt_event("r1", main.MQTT_GPS_TOPIC, FIX)
    assert ev.type == "gps" and ev.data.source == "gnss"
    with pytest.raises(KeyError):
        main.mqtt_event("r1", main.MQTT_GPS_STATUS_TOPIC, b'{"satellites":3}')
    with pytest.raises(ValidationError):
        main.mqtt_event("r1", main.MQTT_GPS_STATUS_TOPIC, b'{"fix":"maybe","satellites":3}')
    with pytest.raises(ValidationError):
        main.mqtt_event("r1", main.MQTT_GPS_STATUS_TOPIC, b'{"fix":true,"satellites":300}')


def test_apply_updates_snapshot_and_clients(env):
    loop, robot, client = env
    t0 = time.time()
    ev = main.mqtt_event("r1", main.MQTT_GPS_STATUS_TOPIC, STATUS)
    ev.ts = t0
    robot.apply(ev)
    s = robot.snapshot
    assert s.gps_receiver.satellites == 3 and s.gps_receiver_at == t0 and s.gps is None
    assert robot.last_seen is None  # status odbiornika nie oznacza, ze robot (ROS) nadaje
    assert [e["type"] for _, e in client.frames] == ["gps_receiver"]
    assert client.frames[0][1]["data"] == {"fix": False, "satellites": 3, "nmea_alive": True, "published": 0}
    assert "gps_receiver" in main.THROTTLED
    snap = robot.current_snapshot().model_dump()
    assert snap["gps_receiver"]["fix"] is False and snap["gps_receiver_at"] == t0
