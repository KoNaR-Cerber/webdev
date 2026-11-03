# Wi-Fi fallback position → MQTT

`wifi_locator.py` scans the Wi-Fi networks around the Jetson with `nmcli`, asks
the Google Geolocation API for a position estimate and publishes it on the same
MQTT topic as the GNSS publisher (`cerber/gps/data`) in the public `GPSFix`
format, with `source: "wifi"`, `accuracy_m` (error radius in metres),
`satellites: 0` and `fix_quality: 0`. It exists so the API and the live panel
have a position indoors, where the Quectel GNSS receiver has no fix.

The gateway keeps GNSS authoritative: while it has a GNSS fix younger than
`GPS_GNSS_HOLD_S` (default 60 s), Wi-Fi samples are dropped. When the receiver
gets a real fix outdoors, it replaces the Wi-Fi estimate immediately.

Standard library only; Python 3.8+. No coordinates, BSSIDs or the API key are
written to the journal.

## How it decides when to query

- scan every `CERBER_WIFI_SCAN_INTERVAL_S` (30 s); fewer than
  `CERBER_WIFI_MIN_APS` (3) visible networks: nothing is published;
- the Geolocation API is asked when there is no estimate yet, when the last
  query is older than `CERBER_WIFI_MAX_QUERY_INTERVAL_S` (600 s), or when less
  than half of the networks sent with the last query are still visible (the
  robot moved). Never more often than `CERBER_WIFI_MIN_QUERY_INTERVAL_S` (120 s);
- between queries the last estimate is re-published with the current time as
  long as the surroundings still match. After a move, nothing is published
  until the next allowed query, so a stale position is never presented as fresh;
- estimates with an error radius above `CERBER_WIFI_MAX_ACCURACY_M` (500 m) are
  not published. A `404 notFound` from Google ("cannot estimate") is logged and
  retried after the minimum interval.

Cost: a parked robot makes about 144 queries per day, a moving one at most 720.
Google's Geolocation API has a free monthly allowance (10 000 calls at the time
of writing); restrict the key to that single API in Google Cloud.

## Install on the Jetson

```sh
sudo install -d -m 0755 /opt/cerber-wifi-locator /etc/cerber
sudo install -m 0644 wifi_locator.py /opt/cerber-wifi-locator/
sudo install -m 0600 runtime-env.example /etc/cerber/wifi-locator.env   # then fill it in
sudo install -m 0644 cerber-wifi-locator.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Before enabling the service, check the whole path once as the service user:

```sh
sudo -u cerber env $(sudo cat /etc/cerber/wifi-locator.env | xargs) \
  python3 -I /opt/cerber-wifi-locator/wifi_locator.py --once --dry-run
```

It prints `would_publish` with the error radius and the number of networks
used, or the reason nothing would be published. Then
`sudo systemctl enable --now cerber-wifi-locator` and confirm a fresh
`gps` with `"source": "wifi"` in `GET /api/v1/robots/<robot_id>/gps/latest`.

`--check-config` validates the environment without scanning or connecting;
systemd runs it before every start. Ten consecutive scan, query or publish
failures exit nonzero so systemd restarts the service.

Scanning uses `nmcli dev wifi list --rescan auto`, so it works with the scan
cache NetworkManager keeps for the connected Wi-Fi link and does not need root.
If the Jetson's Wi-Fi is in hotspot (AP) mode on the only radio, NetworkManager
cannot scan and the service logs `too_few_aps`; set `CERBER_WIFI_INTERFACE` to a
client-mode interface in that case.

## Tests

```sh
python3 -I -m pytest -q robot/wifi-locator/tests
```

They use a fake `nmcli` output, a fake HTTP opener and a fake MQTT broker on
localhost; no network, API key or real coordinates are involved. The sample
format is checked against `gateway/contract/schemas/GPSFix.json`.
