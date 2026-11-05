"""POST /api/v1/robots/{id}/gps: pozycja z telefonu operatora trafia na MQTT ze zrodlem `phone`;
bez klucza 401, bez brokera 503, dla robota demo 409, zle wspolrzedne 422."""

import json

import pytest
from fastapi.testclient import TestClient

import main
from conftest import TEST_KEY

RID = main.ROBOT_ID
URL = f"/api/v1/robots/{RID}/gps"
H = {"X-API-Key": TEST_KEY}
BODY = {"latitude": 52.31234567, "longitude": 21.0123456, "accuracy_m": 8.4, "altitude": 92.1,
        "time": "2026-11-05T10:30:00Z"}


class FakeMqtt:
    def __init__(self, fail=False):
        self.published, self.fail = [], fail

    async def publish(self, topic, payload):
        if self.fail:
            raise OSError("broker gone")
        self.published.append((topic, json.loads(payload)))


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setitem(main.robots, RID, main.RobotState(RID))
    with TestClient(main.app) as tc:
        yield tc


def test_requires_key(client):
    assert client.post(URL, json=BODY).status_code == 401
    assert client.post(URL, json=BODY, headers={"X-API-Key": "wrong"}).status_code == 401


def test_without_broker_503(client, monkeypatch):
    monkeypatch.setattr(main, "mqtt_client", None)
    r = client.post(URL, json=BODY, headers=H)
    assert r.status_code == 503 and "broker" in r.json()["detail"].lower()


def test_publishes_phone_fix(client, monkeypatch):
    fake = FakeMqtt()
    monkeypatch.setattr(main, "mqtt_client", fake)
    r = client.post(URL, json=BODY, headers=H)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["source"] == "phone" and body["accuracy_m"] == 8.4 and body["satellites"] == 0
    assert body["latitude"] == 52.31234567 and body["altitude"] == 92.1
    assert len(fake.published) == 1
    topic, msg = fake.published[0]
    assert topic == main.MQTT_GPS_TOPIC
    assert msg == {"date": "2026-11-05T10:30:00Z", "latitude": 52.31234567, "longitude": 21.0123456,
                   "altitude": 92.1, "satellites": 0, "fix_quality": 0, "source": "phone", "accuracy_m": 8.4}
    # to, co poszlo na MQTT, parsuje sie z powrotem jak fix z robota
    fix = main.gps_from_mqtt(msg)
    assert fix.source == "phone" and fix.time.isoformat().startswith("2026-11-05T10:30:00")


def test_defaults_time_and_altitude(client, monkeypatch):
    fake = FakeMqtt()
    monkeypatch.setattr(main, "mqtt_client", fake)
    r = client.post(URL, json={"latitude": 1.0, "longitude": 2.0, "accuracy_m": 0}, headers=H)
    assert r.status_code == 202
    msg = fake.published[0][1]
    assert msg["altitude"] == 0.0 and msg["date"].endswith("Z") and r.json()["time"] is not None


def test_publish_failure_503(client, monkeypatch):
    monkeypatch.setattr(main, "mqtt_client", FakeMqtt(fail=True))
    assert client.post(URL, json=BODY, headers=H).status_code == 503


@pytest.mark.parametrize("bad", [{"latitude": 91, "longitude": 0, "accuracy_m": 1},
                                 {"latitude": 0, "longitude": 181, "accuracy_m": 1},
                                 {"latitude": 0, "longitude": 0, "accuracy_m": -1},
                                 {"latitude": 0, "longitude": 0},
                                 {"latitude": 0, "longitude": 0, "accuracy_m": 1, "extra": 1}])
def test_validation(client, monkeypatch, bad):
    monkeypatch.setattr(main, "mqtt_client", FakeMqtt())
    assert client.post(URL, json=bad, headers=H).status_code == 422


def test_demo_robot_409(client, monkeypatch):
    monkeypatch.setattr(main, "mqtt_client", FakeMqtt())
    monkeypatch.setitem(main.robots, "demo-x", main.DemoRobotState("demo-x"))
    assert client.post("/api/v1/robots/demo-x/gps", json=BODY, headers=H).status_code == 409
    assert client.post("/api/v1/robots/nope/gps", json=BODY, headers=H).status_code == 404
