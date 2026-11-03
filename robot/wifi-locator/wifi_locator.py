#!/usr/bin/env python3
"""Wi-Fi fallback position for the Cerber public API.

Scans nearby Wi-Fi networks with nmcli (or `iw` when the radio runs a hotspot,
where NetworkManager cannot scan), asks the Google Geolocation API for a
position estimate and publishes it on the robot GPS MQTT topic in the public
GPS format with `source: "wifi"` and `accuracy_m`. The gateway ignores these
samples while it has a fresh GNSS fix, so the real receiver always wins.

Standard library only. Logs never contain coordinates, BSSIDs or the API key.
"""

import argparse
import ipaddress
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

GOOGLE_URL = "https://www.googleapis.com/geolocation/v1/geolocate"
CLIENT_ID = b"cerber-wifi-locator"
MAX_CONSECUTIVE_FAILURES = 10


def log(event, **values):
    print(json.dumps({"event": event, **values}, sort_keys=True), flush=True)


def env_str(environ, name, default=None):
    value = environ.get(name, "").strip()
    if value:
        return value
    if default is None:
        raise ValueError(f"Missing {name}")
    return default


def env_number(environ, name, default, lo, hi, kind=float):
    raw = environ.get(name, "").strip()
    try:
        value = kind(raw) if raw else default
    except ValueError as ex:
        raise ValueError(f"{name} must be a number") from ex
    if not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}")
    return value


class Config:
    def __init__(self, environ):
        self.api_key = env_str(environ, "CERBER_WIFI_GOOGLE_API_KEY")
        if any(c.isspace() for c in self.api_key) or len(self.api_key) < 20:
            raise ValueError("CERBER_WIFI_GOOGLE_API_KEY does not look like an API key")
        self.mqtt_host = str(ipaddress.ip_address(env_str(environ, "CERBER_WIFI_MQTT_HOST")))
        self.mqtt_port = env_number(environ, "CERBER_WIFI_MQTT_PORT", 1883, 1, 65535, int)
        self.mqtt_topic = env_str(environ, "CERBER_WIFI_MQTT_TOPIC", "cerber/gps/data")
        if any(c.isspace() for c in self.mqtt_topic) or "#" in self.mqtt_topic or "+" in self.mqtt_topic:
            raise ValueError("CERBER_WIFI_MQTT_TOPIC must be a plain topic name")
        source = environ.get("CERBER_WIFI_MQTT_SOURCE_IP", "").strip()
        self.mqtt_source_ip = str(ipaddress.ip_address(source)) if source else None
        interface = environ.get("CERBER_WIFI_INTERFACE", "").strip()
        if interface and (any(c.isspace() for c in interface) or interface.startswith("-")):
            raise ValueError("CERBER_WIFI_INTERFACE is not an interface name")
        self.interface = interface or None
        self.scanner = env_str(environ, "CERBER_WIFI_SCANNER", "nmcli")
        if self.scanner not in ("nmcli", "iw"):
            raise ValueError("CERBER_WIFI_SCANNER must be nmcli or iw")
        if self.scanner == "iw" and not self.interface:
            raise ValueError("CERBER_WIFI_INTERFACE is required with the iw scanner")
        self.nmcli = env_str(environ, "CERBER_WIFI_NMCLI", "/usr/bin/nmcli")
        self.iw = env_str(environ, "CERBER_WIFI_IW", "/usr/sbin/iw")
        if not os.path.isabs(self.nmcli) or not os.path.isabs(self.iw):
            raise ValueError("CERBER_WIFI_NMCLI and CERBER_WIFI_IW must be absolute paths")
        self.scan_interval = env_number(environ, "CERBER_WIFI_SCAN_INTERVAL_S", 30.0, 5.0, 3600.0)
        self.min_query_interval = env_number(environ, "CERBER_WIFI_MIN_QUERY_INTERVAL_S", 120.0, 10.0, 86400.0)
        self.max_query_interval = env_number(environ, "CERBER_WIFI_MAX_QUERY_INTERVAL_S", 600.0, 10.0, 86400.0)
        if self.max_query_interval < self.min_query_interval:
            raise ValueError("CERBER_WIFI_MAX_QUERY_INTERVAL_S must not be below the minimum interval")
        self.max_accuracy_m = env_number(environ, "CERBER_WIFI_MAX_ACCURACY_M", 500.0, 1.0, 100000.0)
        self.min_aps = env_number(environ, "CERBER_WIFI_MIN_APS", 3, 1, 50, int)
        self.max_aps = env_number(environ, "CERBER_WIFI_MAX_APS", 15, 1, 50, int)
        if self.max_aps < self.min_aps:
            raise ValueError("CERBER_WIFI_MAX_APS must not be below CERBER_WIFI_MIN_APS")


# --- Wi-Fi scan ---------------------------------------------------------------


def split_nmcli(line):
    """nmcli -t escapes ':' inside values as '\\:'; split on the unescaped ones."""
    fields, current, escaped = [], [], False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(ch)
    fields.append("".join(current))
    return fields


def parse_nmcli(text, max_aps):
    """Lines of `nmcli -t -f BSSID,SIGNAL,CHAN dev wifi list` -> strongest access points first,
    in the Google Geolocation API shape. nmcli SIGNAL is a percentage; dBm ~= percent / 2 - 100."""
    seen = {}
    for line in text.splitlines():
        parts = split_nmcli(line.strip())
        if len(parts) < 3:
            continue
        bssid, signal, channel = parts[0].upper(), parts[1], parts[2]
        if len(bssid) != 17 or bssid.count(":") != 5 or not signal.isdigit():
            continue
        dbm = round(int(signal) / 2 - 100)
        ap = {"macAddress": bssid, "signalStrength": dbm}
        if channel.isdigit() and int(channel) > 0:
            ap["channel"] = int(channel)
        if bssid not in seen or seen[bssid]["signalStrength"] < dbm:
            seen[bssid] = ap
    aps = sorted(seen.values(), key=lambda a: (-a["signalStrength"], a["macAddress"]))
    return aps[:max_aps]


def channel_of(freq_mhz):
    """802.11 channel number for a 2.4/5 GHz centre frequency; None when unknown."""
    if 2412 <= freq_mhz <= 2472:
        return (freq_mhz - 2407) // 5
    if freq_mhz == 2484:
        return 14
    if 5000 < freq_mhz < 5900:
        return (freq_mhz - 5000) // 5
    return None


def parse_iw(text, max_aps, own_mac=None):
    """Output of `iw dev <if> scan` -> strongest access points first. Works while the radio is an
    access point (hotspot), where nmcli lists only the hotspot itself. Needs CAP_NET_ADMIN."""
    seen, mac, freq, dbm = {}, None, None, None

    def flush():
        if mac and dbm is not None and mac != own_mac:
            ap = {"macAddress": mac, "signalStrength": dbm}
            if freq and channel_of(freq):
                ap["channel"] = channel_of(freq)
            if mac not in seen or seen[mac]["signalStrength"] < dbm:
                seen[mac] = ap

    for line in text.splitlines():
        s = line.strip()
        if line.startswith("BSS ") and len(s) >= 21:
            flush()
            candidate = s[4:21].upper()
            mac = candidate if candidate.count(":") == 5 and len(candidate) == 17 else None
            freq = dbm = None
        elif s.startswith("freq:"):
            try:
                freq = int(float(s[5:].split()[0]))
            except (ValueError, IndexError):
                freq = None
        elif s.startswith("signal:"):
            try:
                dbm = round(float(s[7:].split()[0]))
            except (ValueError, IndexError):
                dbm = None
    flush()
    aps = sorted(seen.values(), key=lambda a: (-a["signalStrength"], a["macAddress"]))
    return aps[:max_aps]


def own_mac(interface):
    try:
        with open(f"/sys/class/net/{interface}/address", encoding="ascii") as f:
            return f.read().strip().upper()
    except OSError:
        return None


def scan(cfg):
    if cfg.scanner == "iw":
        result = subprocess.run([cfg.iw, "dev", cfg.interface, "scan"], capture_output=True, text=True,
                                timeout=30, check=True)
        return parse_iw(result.stdout, cfg.max_aps, own_mac(cfg.interface))
    cmd = [cfg.nmcli, "-t", "-f", "BSSID,SIGNAL,CHAN", "dev", "wifi", "list", "--rescan", "auto"]
    if cfg.interface:
        cmd += ["ifname", cfg.interface]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=True)
    return parse_nmcli(result.stdout, cfg.max_aps)


def environment_changed(previous, current, min_overlap=0.5):
    """True when fewer than min_overlap of the previously queried BSSIDs are still visible."""
    if not previous:
        return True
    now = {ap["macAddress"] for ap in current}
    return len(previous & now) / len(previous) < min_overlap


# --- Google Geolocation API ------------------------------------------------------


class NoEstimate(Exception):
    """The service could not estimate a position from these access points."""


def geolocate(cfg, aps, opener=urllib.request.urlopen):
    body = json.dumps({"considerIp": False, "wifiAccessPoints": aps}).encode()
    request = urllib.request.Request(
        GOOGLE_URL, data=body, method="POST",
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": cfg.api_key},
    )
    try:
        with opener(request, timeout=15) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as ex:
        detail = ""
        try:
            detail = json.loads(ex.read().decode()).get("error", {}).get("status", "")
        except Exception:
            pass
        if ex.code == 404:
            raise NoEstimate(detail or "notFound") from None
        raise RuntimeError(f"geolocation HTTP {ex.code} {detail}".strip()) from None
    location = payload.get("location") or {}
    lat, lng, accuracy = location.get("lat"), location.get("lng"), payload.get("accuracy")
    if not all(isinstance(v, (int, float)) for v in (lat, lng, accuracy)):
        raise RuntimeError("geolocation response without location/accuracy")
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0 and accuracy >= 0):
        raise RuntimeError("geolocation response out of range")
    return float(lat), float(lng), float(accuracy)


def sample(lat, lng, accuracy, when):
    """Public GPS format (see gateway/contract/schemas/GPSFix.json) for a Wi-Fi estimate."""
    return {
        "date": datetime.fromtimestamp(when, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latitude": round(lat, 7),
        "longitude": round(lng, 7),
        "altitude": 0.0,
        "satellites": 0,
        "fix_quality": 0,
        "source": "wifi",
        "accuracy_m": round(accuracy, 1),
    }


# --- minimal MQTT 3.1.1 publisher (QoS 0, one connection per publish) --------------


def _remaining_length(n):
    out = bytearray()
    while True:
        byte, n = n % 128, n // 128
        if n:
            byte |= 0x80
        out.append(byte)
        if not n:
            return bytes(out)


def _packet(kind, body):
    return bytes([kind]) + _remaining_length(len(body)) + body


def mqtt_connect_packet(keepalive=30):
    body = (b"\x00\x04MQTT" + b"\x04" + b"\x02" + keepalive.to_bytes(2, "big")
            + len(CLIENT_ID).to_bytes(2, "big") + CLIENT_ID)
    return _packet(0x10, body)


def mqtt_publish_packet(topic, payload):
    t = topic.encode()
    return _packet(0x30, len(t).to_bytes(2, "big") + t + payload)


def mqtt_publish(cfg, payload, timeout=5.0):
    with socket.create_connection((cfg.mqtt_host, cfg.mqtt_port), timeout=timeout,
                                  source_address=(cfg.mqtt_source_ip, 0) if cfg.mqtt_source_ip else None) as s:
        s.sendall(mqtt_connect_packet())
        ack = b""
        while len(ack) < 4:
            chunk = s.recv(4 - len(ack))
            if not chunk:
                raise ConnectionError("broker closed the connection before CONNACK")
            ack += chunk
        if ack[0] != 0x20 or ack[3] != 0:
            raise ConnectionError(f"broker refused the connection (code {ack[3]})")
        s.sendall(mqtt_publish_packet(cfg.mqtt_topic, payload))
        s.sendall(b"\xe0\x00")  # DISCONNECT


# --- main loop ---------------------------------------------------------------------


class Locator:
    def __init__(self, cfg, scanner=scan, locate=geolocate, publish=mqtt_publish, clock=time.time):
        self.cfg, self.scanner, self.locate, self.publish, self.clock = cfg, scanner, locate, publish, clock
        self.estimate = None  # (lat, lng, accuracy)
        self.queried = set()  # BSSIDs sent with the last successful query
        self.last_query = None
        self.failures = 0

    def step(self, dry_run=False):
        """One scan; returns the published sample or None. Raises after too many consecutive failures."""
        try:
            aps = self.scanner(self.cfg)
        except Exception as ex:
            self.estimate = None
            return self._failed("scan_failed", ex)
        if len(aps) < self.cfg.min_aps:
            self.estimate = None
            log("too_few_aps", seen=len(aps), needed=self.cfg.min_aps)
            self.failures = 0
            return None
        now = self.clock()
        since_query = None if self.last_query is None else now - self.last_query
        can_query = since_query is None or since_query >= self.cfg.min_query_interval
        changed = environment_changed(self.queried, aps)
        due = self.estimate is None or since_query >= self.cfg.max_query_interval or changed
        if due and can_query:
            self.last_query, changed = now, False
            try:
                lat, lng, accuracy = self.locate(self.cfg, aps)
            except NoEstimate as ex:
                self.estimate, self.queried = None, {ap["macAddress"] for ap in aps}
                log("no_estimate", reason=str(ex), aps=len(aps))
                self.failures = 0
                return None
            except Exception as ex:
                self.estimate = None
                return self._failed("geolocation_failed", ex)
            self.queried = {ap["macAddress"] for ap in aps}
            if accuracy > self.cfg.max_accuracy_m:
                self.estimate = None
                log("estimate_too_coarse", accuracy_m=round(accuracy), limit_m=self.cfg.max_accuracy_m, aps=len(aps))
                self.failures = 0
                return None
            self.estimate = (lat, lng, accuracy)
            log("estimate", accuracy_m=round(accuracy), aps=len(aps))
        if self.estimate is None:
            return None
        if changed:  # networks around differ from the queried set, but quota says wait: no stale position
            log("environment_changed", retry_in_s=round(self.cfg.min_query_interval - since_query), aps=len(aps))
            return None
        lat, lng, accuracy = self.estimate
        payload = sample(lat, lng, accuracy, now)
        if not dry_run:
            try:
                self.publish(self.cfg, json.dumps(payload, separators=(",", ":")).encode())
            except Exception as ex:
                return self._failed("publish_failed", ex)
        self.failures = 0
        log("published" if not dry_run else "would_publish", accuracy_m=payload["accuracy_m"], aps=len(aps),
            estimate_age_s=round(now - self.last_query))
        return payload

    def _failed(self, event, ex):
        self.failures += 1
        log(event, error=f"{type(ex).__name__}: {ex}"[:200], consecutive=self.failures)
        if self.failures >= MAX_CONSECUTIVE_FAILURES:
            raise RuntimeError(f"{self.failures} consecutive failures, last: {event}")
        return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check-config", action="store_true", help="validate the environment and exit")
    parser.add_argument("--once", action="store_true", help="one scan/query/publish cycle, then exit")
    parser.add_argument("--dry-run", action="store_true", help="scan and query, but do not publish")
    args = parser.parse_args(argv)
    try:
        cfg = Config(os.environ)
    except ValueError as ex:
        log("configuration_invalid", error=str(ex))
        return 2
    if args.check_config:
        log("configuration_valid", scanner=cfg.scanner, interface=cfg.interface, scan_interval_s=cfg.scan_interval)
        return 0

    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, stop)

    locator = Locator(cfg)
    log("started", scanner=cfg.scanner, interface=cfg.interface, scan_interval_s=cfg.scan_interval, dry_run=args.dry_run)
    while not stopping:
        try:
            published = locator.step(dry_run=args.dry_run)
        except RuntimeError as ex:
            log("giving_up", error=str(ex))
            return 1
        if args.once:
            return 0 if published else 3
        deadline = time.monotonic() + cfg.scan_interval
        while not stopping and time.monotonic() < deadline:
            time.sleep(0.5)
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
