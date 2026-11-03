"""Zrodlo pozycji: `source`/`accuracy_m` z MQTT (domyslnie gnss, bez promienia); pozycja zastepcza (wifi)
nie nadpisuje fixu gnss mlodszego niz GPS_GNSS_HOLD_S i nie idzie wtedy do klientow WS; po uplywie
wstrzymania wifi wchodzi, a gnss zawsze wraca od razu."""

import json
import time

import pytest
from pydantic import ValidationError

import contracts as c
import main

GNSS = {"date": "2026-11-03T10:00:00Z", "latitude": 51.1, "longitude": 17.0, "altitude": 118.4,
        "satellites": 9, "fix_quality": 1}
WIFI = {"date": "2026-11-03T10:00:05Z", "latitude": 51.2, "longitude": 17.1, "altitude": 0.0,
        "satellites": 0, "fix_quality": 0, "source": "wifi", "accuracy_m": 35.0}


def ev(payload, ts):
    return c.GpsEvent(robot_id="r1", ts=ts, data=main.gps_from_mqtt(payload))


def test_parse_defaults_and_wifi():
    g = main.gps_from_mqtt(GNSS)
    assert (g.source, g.accuracy_m) == ("gnss", None)
    w = main.gps_from_mqtt(WIFI)
    assert (w.source, w.accuracy_m, w.satellites, w.fix_quality) == ("wifi", 35.0, 0, 0)
    assert json.loads(w.model_dump_json())["source"] == "wifi"
    with pytest.raises(ValidationError):
        main.gps_from_mqtt({**WIFI, "source": "guess"})
    with pytest.raises(ValidationError):
        main.gps_from_mqtt({**WIFI, "accuracy_m": -1})


def test_wifi_does_not_override_fresh_gnss(env, monkeypatch):
    loop, robot, client = env
    monkeypatch.setattr(main, "GPS_GNSS_HOLD_S", 60.0)
    t0 = time.time()
    robot.apply(ev(GNSS, t0))
    sent = len(client.frames)
    robot.apply(ev(WIFI, t0 + 10))
    assert robot.snapshot.gps.source == "gnss" and robot.snapshot.gps_at == t0
    assert len(client.frames) == sent  # nic nie poszlo do klientow
    robot.apply(ev(WIFI, t0 + 61))
    assert robot.snapshot.gps.source == "wifi" and robot.snapshot.gps.accuracy_m == 35.0
    assert robot.snapshot.gps_at == t0 + 61


def test_gnss_replaces_wifi_immediately(env):
    loop, robot, client = env
    t0 = time.time()
    robot.apply(ev(WIFI, t0))
    assert robot.snapshot.gps.source == "wifi"
    robot.apply(ev(GNSS, t0 + 1))
    assert robot.snapshot.gps.source == "gnss" and robot.snapshot.gps.satellites == 9


def test_wifi_refreshes_wifi(env):
    loop, robot, client = env
    t0 = time.time()
    robot.apply(ev(WIFI, t0))
    robot.apply(ev({**WIFI, "latitude": 51.3}, t0 + 1))
    assert robot.snapshot.gps.latitude == 51.3 and robot.snapshot.gps_at == t0 + 1
