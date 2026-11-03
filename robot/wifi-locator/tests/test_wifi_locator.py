"""Wi-Fi locator: nmcli parsing, configuration, Google request shape (key in a header, never in the URL),
public GPS sample vs the gateway contract, minimal MQTT publish against a fake broker, and the query policy
(min/max intervals, environment change, no estimate, coarse estimate, consecutive failures)."""

import io
import json
import pathlib
import socket
import sys
import threading
import urllib.error

import pytest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import wifi_locator as wl  # noqa: E402

KEY = "AIza" + "x" * 35
ENV = {"CERBER_WIFI_GOOGLE_API_KEY": KEY, "CERBER_WIFI_MQTT_HOST": "127.0.0.1"}
NMCLI = (
    "AA\\:BB\\:CC\\:DD\\:EE\\:01:80:6\n"
    "AA\\:BB\\:CC\\:DD\\:EE\\:02:40:36\n"
    "aa\\:bb\\:cc\\:dd\\:ee\\:01:90:6\n"      # same BSSID, stronger: kept once
    "AA\\:BB\\:CC\\:DD\\:EE\\:03:55:0\n"      # channel 0 -> no channel field
    "garbage line\n"
    "AA\\:BB\\:CC\\:DD\\:EE\\:04:abc:1\n"     # signal not a number
    "AA\\:BB\\:CC\\:DD\\:EE\\:05:20:11\n"
)


def cfg(**extra):
    return wl.Config({**ENV, **{k: str(v) for k, v in extra.items()}})


def test_parse_nmcli():
    aps = wl.parse_nmcli(NMCLI, max_aps=15)
    assert [a["macAddress"] for a in aps] == ["AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:03", "AA:BB:CC:DD:EE:02",
                                               "AA:BB:CC:DD:EE:05"]
    assert aps[0] == {"macAddress": "AA:BB:CC:DD:EE:01", "signalStrength": -55, "channel": 6}
    assert "channel" not in aps[1]
    assert wl.parse_nmcli(NMCLI, max_aps=2)[-1]["macAddress"] == "AA:BB:CC:DD:EE:03"
    assert wl.parse_nmcli("", 15) == []


def test_config():
    c = cfg()
    assert (c.mqtt_port, c.mqtt_topic, c.interface, c.scan_interval) == (1883, "cerber/gps/data", None, 30.0)
    assert cfg(CERBER_WIFI_INTERFACE="wlan0", CERBER_WIFI_MQTT_SOURCE_IP="10.0.0.2").mqtt_source_ip == "10.0.0.2"
    for bad in ({"CERBER_WIFI_GOOGLE_API_KEY": ""}, {"CERBER_WIFI_GOOGLE_API_KEY": "short"},
                {"CERBER_WIFI_MQTT_HOST": "broker.example"}, {"CERBER_WIFI_MQTT_TOPIC": "a/#"},
                {"CERBER_WIFI_MAX_QUERY_INTERVAL_S": "60"}, {"CERBER_WIFI_SCAN_INTERVAL_S": "1"},
                {"CERBER_WIFI_INTERFACE": "--bad"}, {"CERBER_WIFI_NMCLI": "nmcli"}):
        with pytest.raises(ValueError):
            wl.Config({**ENV, **bad})


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_geolocate_request_and_errors():
    seen = {}

    def opener(request, timeout):
        seen["url"], seen["headers"], seen["body"] = request.full_url, request.headers, json.loads(request.data)
        return FakeResponse(json.dumps({"location": {"lat": 51.1, "lng": 17.0}, "accuracy": 32.5}).encode())

    aps = [{"macAddress": "AA:BB:CC:DD:EE:01", "signalStrength": -55, "channel": 6}]
    assert wl.geolocate(cfg(), aps, opener) == (51.1, 17.0, 32.5)
    assert KEY not in seen["url"] and seen["headers"]["X-goog-api-key"] == KEY
    assert seen["body"] == {"considerIp": False, "wifiAccessPoints": aps}

    def http_error(code, status):
        def opener(request, timeout):
            raise urllib.error.HTTPError(request.full_url, code, "x", {}, io.BytesIO(
                json.dumps({"error": {"status": status}}).encode()))
        return opener

    with pytest.raises(wl.NoEstimate):
        wl.geolocate(cfg(), aps, http_error(404, "NOT_FOUND"))
    with pytest.raises(RuntimeError, match="403 PERMISSION_DENIED"):
        wl.geolocate(cfg(), aps, http_error(403, "PERMISSION_DENIED"))
    with pytest.raises(RuntimeError):
        wl.geolocate(cfg(), aps, lambda r, timeout: FakeResponse(b'{"location": {"lat": 91, "lng": 0}, "accuracy": 1}'))


def test_sample_matches_public_contract():
    s = wl.sample(51.10788512345, 17.0385381, 35.04, 1793700000)
    assert s == {"date": "2026-11-03T10:00:00Z", "latitude": 51.1078851, "longitude": 17.0385381, "altitude": 0.0,
                 "satellites": 0, "fix_quality": 0, "source": "wifi", "accuracy_m": 35.0}
    schema = HERE.parent.parent.parent / "gateway" / "contract" / "schemas" / "GPSFix.json"
    if schema.exists():
        props = json.loads(schema.read_text())["properties"]
        assert set(s) - {"date"} <= set(props) and "source" in props and "accuracy_m" in props


def _read_packet(conn):
    head = conn.recv(1)[0]
    length, mult = 0, 1
    while True:
        b = conn.recv(1)[0]
        length += (b & 0x7F) * mult
        mult *= 128
        if not b & 0x80:
            break
    body = b""
    while len(body) < length:
        body += conn.recv(length - len(body))
    return head >> 4, body


def test_mqtt_publish_roundtrip():
    got = {}
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def broker():
        conn, _ = srv.accept()
        with conn:
            kind, body = _read_packet(conn)
            got["connect"] = (kind, body[:7], body[7], body[8])
            conn.sendall(b"\x20\x02\x00\x00")
            kind, body = _read_packet(conn)
            tlen = int.from_bytes(body[:2], "big")
            got["publish"] = (kind, body[2:2 + tlen].decode(), body[2 + tlen:])
            got["disconnect"] = _read_packet(conn)[0]

    t = threading.Thread(target=broker, daemon=True)
    t.start()
    wl.mqtt_publish(cfg(CERBER_WIFI_MQTT_PORT=srv.getsockname()[1]), b'{"x":1}')
    t.join(5)
    assert got["connect"] == (1, b"\x00\x04MQTT\x04", 0x02, 0)  # 3.1.1, clean session, no will/credentials
    assert got["publish"] == (3, "cerber/gps/data", b'{"x":1}') and got["disconnect"] == 14


def test_mqtt_refused():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def broker():
        conn, _ = srv.accept()
        with conn:
            _read_packet(conn)
            conn.sendall(b"\x20\x02\x00\x05")

    threading.Thread(target=broker, daemon=True).start()
    with pytest.raises(ConnectionError, match="code 5"):
        wl.mqtt_publish(cfg(CERBER_WIFI_MQTT_PORT=srv.getsockname()[1]), b"{}")


def aps(*suffixes, signal=-60):
    return [{"macAddress": f"AA:BB:CC:DD:EE:{s:02X}", "signalStrength": signal} for s in suffixes]


class Harness:
    def __init__(self, c=None, located=(51.1, 17.0, 30.0)):
        self.now, self.aps, self.located = 0.0, aps(1, 2, 3, 4), located
        self.queries, self.published = 0, []
        self.locator = wl.Locator(c or cfg(), scanner=lambda cfg: self.aps, locate=self.locate,
                                  publish=lambda cfg, payload: self.published.append(json.loads(payload)),
                                  clock=lambda: self.now)

    def locate(self, cfg, aps):
        self.queries += 1
        if isinstance(self.located, Exception):
            raise self.located
        return self.located

    def step(self, at):
        self.now = float(at)
        return self.locator.step()


def test_query_policy():
    h = Harness()  # min 120 s, max 600 s
    assert h.step(0) and h.queries == 1
    assert h.step(30) and h.queries == 1  # same networks: cached estimate, fresh date
    assert h.published[-1]["date"] == "1970-01-01T00:00:30Z"
    assert h.step(601) and h.queries == 2  # max interval
    h.aps = aps(7, 8, 9, 10)  # moved: nothing in common
    assert h.step(631) is None and h.queries == 2  # changed, but quota: no stale position published
    assert h.step(721) and h.queries == 3
    h.aps = aps(7, 8, 9, 11)  # 3/4 still visible: no new query
    assert h.step(900) and h.queries == 3


def test_no_estimate_and_coarse_and_few_aps():
    h = Harness(located=wl.NoEstimate("notFound"))
    assert h.step(0) is None and h.step(30) is None and h.queries == 1  # retry only after the min interval
    assert h.step(120) is None and h.queries == 2
    h = Harness(located=(51.1, 17.0, 900.0))
    assert h.step(0) is None and h.published == []
    h = Harness()
    h.aps = aps(1, 2)
    assert h.step(0) is None and h.queries == 0


def test_failures_give_up():
    h = Harness(located=RuntimeError("geolocation HTTP 403"))
    for i in range(wl.MAX_CONSECUTIVE_FAILURES - 1):
        assert h.step(i * 200) is None
    with pytest.raises(RuntimeError, match="consecutive"):
        h.step(5000)
    h = Harness()
    h.locator.scanner = lambda cfg: (_ for _ in ()).throw(OSError("nmcli"))
    for i in range(wl.MAX_CONSECUTIVE_FAILURES - 1):
        h.step(i)
    with pytest.raises(RuntimeError):
        h.step(99)


def test_check_config(monkeypatch, capsys):
    monkeypatch.setattr(wl.os, "environ", ENV)
    assert wl.main(["--check-config"]) == 0
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["event"] == "configuration_valid"
    monkeypatch.setattr(wl.os, "environ", {})
    assert wl.main(["--check-config"]) == 2
