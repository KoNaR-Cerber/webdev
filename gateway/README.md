# Cerber Telemetry Gateway

Publiczne, read-only API telemetrii robota Cerber (DEEP Robotics Lite3 Venture).
Gateway stoi w sieci VPN, czyta rosbridge i MQTT, a na zewnątrz wystawia
wyłącznie odczyt: REST + WebSocket. Sterowanie nie jest wystawione.

```
robot (ROS 2) --rosbridge ws:9090 (VPN)--> gateway (serwer w VPN) --nginx 443--> świat
GPS           --MQTT cerber/gps/data-^
```

## Kontrakt

Kontrakt jest generowany z kodu (`contracts.py`), nie pisany ręcznie:

| Plik | Co to jest |
| --- | --- |
| `contract/openapi.json` | OpenAPI 3.1 — wszystkie endpointy REST, schematy, `securitySchemes`, plus `x-websockets` opisujące strumień WS |
| `contract/schemas/*.json` | JSON Schema (draft 2020-12) każdego modelu publicznego, do walidacji po stronie klienta/CI |
| `contract/examples/*.json` | przykładowe payloady, zwalidowane modelami i schematami |

Regeneracja po zmianie modeli: `python export_contract.py`.

## Endpointy

| Metoda | Ścieżka | Zwraca |
| --- | --- | --- |
| GET | `/health` | `Health` — stan połączeń z rosbridge i MQTT (bez klucza) |
| GET | `/api/v1/robots` | `RobotList` |
| GET | `/api/v1/robots/{robot_id}` | `RobotSummary` (`online` = coś przyszło w ciągu `STALE_AFTER_S`) |
| GET | `/api/v1/robots/{robot_id}/telemetry/latest` | `TelemetrySnapshot` — ostatni znany stan, sekcje `null` dopóki nie przyjdą |
| GET | `/api/v1/robots/{robot_id}/gps/latest` | `GPSFix` albo 404 |
| GET | `/api/v1/robots/{robot_id}/streams` | `VideoStreamList` — adresy WHEP; `vpn_only` z `STREAMS_VPN_ONLY` |
| WS | `/api/v1/robots/{robot_id}/telemetry/stream?api_key=…` | ramki `TelemetryEventEnvelope`: pierwsza `snapshot`, potem `imu` / `joints` / `odometry` / `ultrasound` / `ptz` / `gps` / `sensors_alive`; po 20 s bez ruchu od klienta ramka `ping` (też w schemacie); ramki od klienta są ignorowane |

Autoryzacja: nagłówek `X-API-Key` (REST) lub query `api_key` (WS). Zły klucz → 401; na WS połączenie jest
przyjmowane i od razu zamykane kodem 4401 (nieznany `robot_id` → 4404), więc klient widzi kod.

## Uruchomienie

```bash
pip install -r requirements.txt
export API_KEY=... ROSBRIDGE_HOST=10.13.13.2 MQTT_HOST=10.13.13.1
uvicorn main:app --host 0.0.0.0 --port 8000
# docs: http://localhost:8000/docs
```

Zmienne: `ROBOT_ID` (`cerber-lite3-01`), `API_KEY` (wymagany — bez niego aplikacja nie wystartuje), `ROSBRIDGE_HOST/PORT`, `MQTT_HOST/PORT`, `MQTT_GPS_TOPIC`,
`MEDIAMTX_BASE`, `STREAMS_VPN_ONLY` (1), `STALE_AFTER_S` (5), `IMU_MAX_HZ` (10 — throttling ramek WS dla
IMU/joints/odometry/ultrasound; snapshot jest aktualizowany zawsze),
`ROSBRIDGE_ENABLED` / `MQTT_ENABLED` (`0` wyłącza źródło, np. do testów).

## Wystawienie publicznie

Serwis `gateway` jest w `docker-compose.yml` (sieć `cerber_internal`) bez `ports:` — ruch z zewnątrz idzie
tylko przez reverse proxy. Klucz ustaw w `.env` jako `GATEWAY_API_KEY`; bez niego kontener nie wystartuje.

Lokacje dla nginx, **bez** `allow/deny` (zabezpieczeniem jest klucz API). WebSocket niesie klucz w query
(`?api_key=…`), więc jego ścieżka nie trafia do access logu:

```nginx
location ~ ^/api/v1/robots/[^/]+/telemetry/stream$ {
    access_log off;                      # klucz API jest w query string
    proxy_pass http://gateway:8000;      # nazwa serwisu w sieci cerber_internal
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
}
location /api/v1/ {
    proxy_pass http://gateway:8000;
    proxy_set_header Host $host;
}
location = /health { proxy_pass http://gateway:8000; }
```

Strumienie wideo (WebRTC) są poza tym API: `/streams` zwraca tylko adresy WHEP (`MEDIAMTX_BASE`). Flaga
`vpn_only` w odpowiedzi odzwierciedla `STREAMS_VPN_ONLY`, nie stan sieci — dostęp do samych strumieni
ogranicza konfiguracja proxy/firewalla.

## Znane luki (z analizy stocku Lite3)

- `battery_percent` jest zawsze `null`: stockowy node `jetson2motion` nie publikuje baterii. Gdy ROS doda
  publisher (`sensor_msgs/BatteryState`), wystarczy dopisać subskrypcję w `ROS_SUBSCRIPTIONS` i jedno zdarzenie.
- `ts` i `*_at` to czas odbioru przez gateway (epoch), bo `header.stamp` z robota jest monotoniczny.
- Jeden robot (`ROBOT_ID`); drugi = drugi wpis w `robots` i osobny rosbridge/MQTT.
- Jednostki w opisach pól (rad/s, m/s², rad dla stawów) są konwencją `sensor_msgs` — stockowy node przepisuje
  wartości z UDP bez konwersji (kąty RPY konwertuje ze stopni, prędkości już nie), więc warto je raz
  potwierdzić na robocie. `ultrasound` to element `[1]` tablicy `ultrasound[2]` z `RobotState`; który to
  fizycznie czujnik i w jakiej jednostce — źródła nie mówią.
