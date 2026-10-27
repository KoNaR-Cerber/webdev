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
| GET | `/api/v1/robots/{robot_id}` | `RobotSummary` (`online` i `last_seen` jak w `status`, patrz niżej) |
| GET | `/api/v1/robots/{robot_id}/telemetry/latest` | `TelemetrySnapshot` — ostatni znany stan, sekcje `null` dopóki nie przyjdą; pole `status` z chwili odpowiedzi |
| GET | `/api/v1/robots/{robot_id}/gps/latest` | `GPSFix` albo 404 |
| GET | `/api/v1/robots/{robot_id}/streams` | `VideoStreamList` — adresy WHEP; `vpn_only` z `STREAMS_VPN_ONLY` |
| WS | `/api/v1/robots/{robot_id}/telemetry/stream?api_key=…` | ramki `TelemetryEventEnvelope`: pierwsza `snapshot` (z `status`), potem `imu` / `joints` / `odometry` / `ultrasound` / `ptz` / `gps` / `sensors_alive` (każdy typ najwyżej raz na `WS_THROTTLE_S`, patrz niżej) oraz `status` (przy zmianie i co `WS_HEARTBEAT_S`); ramki od klienta są ignorowane (max 4096 B) |

Autoryzacja: nagłówek `X-API-Key` (REST) lub query `api_key` (WS). Zły klucz → 401; na WS połączenie jest
przyjmowane i od razu zamykane kodem 4401 (nieznany `robot_id` → 4404), więc klient widzi kod.

Throttling WS: zdarzenia każdego typu (`imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `sensors_alive`, `gps`)
wychodzą najwyżej raz na `WS_THROTTLE_S` (domyślnie 1 s). Pierwsze zdarzenie danego typu idzie od razu i otwiera
okno; kolejne w oknie tylko podmieniają „ostatnią wartość”, która wychodzi na koniec okna (i otwiera następne).
Dzięki temu ostatni stan zawsze dociera do klienta najpóźniej po `WS_THROTTLE_S`, np. `ptz` MOVING → WAITING
kończy się ramką WAITING. `snapshot` (pierwsza ramka WS i `/telemetry/latest`) jest aktualizowany każdą
wiadomością, a `status` nie jest throttlowany. `WS_THROTTLE_S=0` wyłącza throttling.

Status robota: `{"type":"status","robot_id":…,"ts":<epoch>,"data":RobotStatus}`, gdzie `RobotStatus` =
`{online, last_seen, rosbridge_connected, mqtt_connected}`.

- `online` = połączenie z rosbridge jest otwarte **i** ostatnia wiadomość ROS przyszła w ciągu `STALE_AFTER_S`
  (domyślnie 5 s); `last_seen` = czas ostatniej wiadomości ROS. GPS z MQTT nie podtrzymuje `online` (jego
  świeżość mówi `gps_at`). `online` i `last_seen` w `RobotSummary` (REST) mają tę samą definicję.
- `status` wychodzi do wszystkich klientów od razu, gdy zmieni się `online`, `rosbridge_connected` albo
  `mqtt_connected` (np. robot przestał nadawać → `online: false` najpóźniej ok. 1 s po upływie `STALE_AFTER_S`),
  oraz jako heartbeat co `WS_HEARTBEAT_S` (domyślnie 5 s) do każdego klienta, niezależnie od jego aktywności.
  Klient nie musi odpowiadać. Brak ramek dłużej niż kilka `WS_HEARTBEAT_S` = zerwane połączenie z gatewayem.
- `snapshot` (pierwsza ramka WS) i `/telemetry/latest` mają pole `status` wyliczone w chwili wysłania.

Limity WS (kody zamknięcia są też w `x-websockets.closeCodes`):

| Kod | Kiedy |
| --- | --- |
| 1013 | osiągnięty limit `MAX_WS_CLIENTS` połączeń na robota — połączenie jest przyjmowane i od razu zamykane; spróbuj później |
| 1011 | brak odpowiedzi na ping WS: serwer wysyła ping co 20 s i czeka 20 s na pong. Przy `WS_THROTTLE_S=1` tak zwykle jest rozłączany klient, który przestał czytać (po ~40 s) |
| 1008 / 1006 | klient nie odbiera ramek przy wyższym tempie (np. `WS_THROTTLE_S=0`): każdy klient ma własną kolejkę 100 ramek, przepełnienie = rozłączenie; wolny klient nie spowalnia innych ani zbierania danych z ROS/MQTT. Ramka close z kodem 1008 dochodzi tylko wtedy, gdy bufor TCP zdąży się opróżnić w ciągu 1 s — zwykle gateway po prostu zrywa połączenie bez ramki close, a klient widzi 1006 |
| 1009 | ramka od klienta większa niż 4096 B (`--ws-max-size`, liczone po dekompresji permessage-deflate) |

Po zakończeniu obsługi połączenia WS gateway zrywa gniazdo najpóźniej po 12 s, także gdy klient nie odbiera
zaległych danych. Zerwanie idzie przez RST (`SO_LINGER` 0), więc jądro od razu zwalnia niewysłany bufor
i nie zostaje osierocone gniazdo w `FIN_WAIT_1`; klient widzi reset połączenia (1006).

## Uruchomienie

```bash
pip install -r requirements.txt
export API_KEY=... ROSBRIDGE_HOST=10.13.13.2 MQTT_HOST=10.13.13.1
uvicorn main:app --host 0.0.0.0 --port 8000 --ws-max-size 4096   # to samo co CMD w Dockerfile
# albo: python main.py (limit ramki ustawia sam; adres z `HOST`/`PORT`, domyślnie 0.0.0.0:8000)
# docs: http://localhost:8000/docs
```

Gateway nie czeka na rosbridge: gdy robot/VPN nie odpowiada, API startuje od razu, `/health` mówi
`degraded` (`rosbridge_connected: false`), GPS z MQTT działa, a połączenie z rosbridge jest ponawiane w tle.
Ponawianie ma dwie fazy:

- szybka — przez pierwsze `ROSBRIDGE_FAST_RETRY_S` (300 s) od utraty połączenia (albo od startu, jeśli połączenia
  jeszcze nie było) przerwa zaczyna się od ~1 s i rośnie najwyżej do ~10 s; gdy host w ogóle nie odpowiada (np.
  peer VPN wyłączony), sama próba czeka do 5 s na TCP, więc próby wypadają co ~6–15 s;
- wolna — potem jedna próba co `ROSBRIDGE_SLOW_RETRY_S` (60 s; plus do 5 s samej próby przy milczącym hoście),
  bez końca. Wejście w tę fazę loguje jedną linię
  (`[rosbridge] still unreachable after …`); kolejne próby nie są logowane.

Udane połączenie zeruje politykę: następna utrata połączenia znów zaczyna od fazy szybkiej. Każde udane
połączenie loguje jedną linię (`[rosbridge] connected to …` za pierwszym razem, potem `[rosbridge] reconnected
to …`), utrata — `[rosbridge] connection closed …`. Po każdym połączeniu topiki są subskrybowane dokładnie raz
(nieudane próby niczego nie kolejkują), bez restartu procesu. Wiadomość odrzucona (NaN/Inf, zły format) to jedna
linia `[rosbridge] <topik>: drop …` / `[mqtt] <topik>: drop …`, najwyżej raz na 10 s na topik (z liczbą
pominiętych od poprzedniej linii), więc czujnik zawieszony na NaN nie zalewa logów. Linie `[rosbridge]`/`[mqtt]`
idą na stdout od razu (bez buforowania), także bez `PYTHONUNBUFFERED`. `rosbridge_connected` jest `true` dopiero po handshake'u
WebSocket z rosbridge (samo połączenie TCP to za mało).

Zmienne: `ROBOT_ID` (`cerber-lite3-01`), `ROBOT_MODEL`, `API_KEY` (wymagany — bez niego aplikacja nie wystartuje), `ROSBRIDGE_HOST/PORT`, `MQTT_HOST/PORT`, `MQTT_GPS_TOPIC`,
`MEDIAMTX_BASE`, `STREAMS_VPN_ONLY` (1), `STALE_AFTER_S` (5 — po tylu sekundach bez wiadomości ROS robot jest
offline), `WS_THROTTLE_S` (1.0 — najwyżej jedna ramka WS na typ zdarzenia na tyle sekund; `0` wyłącza),
`WS_HEARTBEAT_S` (5 — co tyle sekund `status` do każdego klienta WS; `0` = tylko przy zmianach), `ROSBRIDGE_FAST_RETRY_S` (300) / `ROSBRIDGE_SLOW_RETRY_S` (60 — fazy
ponawiania połączenia z rosbridge),
`ROSBRIDGE_ENABLED` / `MQTT_ENABLED` (`0` wyłącza źródło, np. do testów),
`MAX_WS_CLIENTS` (20 — limit połączeń WS na robota), `HOST` / `PORT` (tylko dla `python main.py`).

Testy (tylko 127.0.0.1, ok. 1 min; katalog `tests/` nie trafia do obrazu):

```bash
pip install -r requirements.txt pytest httpx websockets
pytest -q tests
```

## Wystawienie publicznie

Serwis `gateway` jest w `docker-compose.yml` (sieć `cerber_internal`) bez `ports:` — ruch z zewnątrz idzie
tylko przez reverse proxy. Klucz ustaw w `.env` jako `GATEWAY_API_KEY`; bez niego kontener nie wystartuje.

Konfiguracja dla nginx (w bloku `server`), **bez** `allow/deny` (zabezpieczeniem jest klucz API).
Upstream idzie przez `resolver` + zmienną, więc nginx startuje i przeładowuje się także wtedy, gdy kontener
gatewaya nie działa (stały `proxy_pass http://gateway:8000` wymaga rozwiązania nazwy przy starcie).

WebSocket niesie klucz w query (`?api_key=…`). Samo `access_log off` nie wystarcza: nginx wpisuje linię
żądania i URI upstreamu (z query) także do `error_log`, np. przy błędzie połączenia z gatewayem. Dlatego
w lokacji WS (także z `/` na końcu ścieżki) wyłączone są oba logi; jeśli te błędy są potrzebne, zamiast
`/dev/null` użyj osobnego pliku z dostępem tylko dla admina i krótką rotacją.

Klienci REST wysyłają klucz **wyłącznie** w nagłówku `X-API-Key`, nigdy w query. Gdyby jednak któryś dopisał
go do URL, access log REST w nginx używa formatu `noquery` (sama ścieżka `$uri`, bez query). `error_log`
lokacji REST przy błędzie upstreamu nadal zawiera pełną linię żądania — ta sama rada: plik tylko dla admina,
krótka rotacja.

Sam gateway wycina ze swoich logów wartość `api_key` (także z zakodowaną nazwą lub separatorem, np.
`%61pi_key`, `api_key%3D`, `api_key%3A`, `"api_key": "…"`, `%22api_key%22%3A%22…`), nagłówek `X-API-Key`
(logi handshake'u na `--log-level debug`), wartości z błędów parsowania nagłówków, a także każde wystąpienie
samego klucza (klucz od 8 znaków) — dosłownie albo z dowolnymi znakami zakodowanymi jako `%XX` w dowolnej
wielkości liter (np. `%2b` z .NET), w ścieżce, query, `raw_path` na `--log-level trace` i w tracebackach.
Ramki WS na `--log-level debug` (od klienta i do klienta, także odesłany PING/CLOSE) są logowane tylko jako
typ i rozmiar, bez treści; na `trace` powód zamknięcia od klienta tylko jako długość.

```nginx
# w kontekście http (np. osobny plik w conf.d/), nie w server: log bez query string
log_format noquery '$remote_addr - $remote_user [$time_local] "$request_method $uri $server_protocol" '
                   '$status $body_bytes_sent "$http_referer" "$http_user_agent"';
```

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;       # DNS Dockera
set $gateway_upstream http://gateway:8000;    # nazwa serwisu w sieci cerber_internal; bez URI -> idzie oryginalne URI z query

location ~ ^/api/v1/robots/[^/]+/telemetry/stream/?$ {
    access_log off;                      # klucz API jest w query string...
    error_log /dev/null;                 # ...i w linii żądania / URI upstreamu w error logu
    proxy_pass $gateway_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
}
location /api/v1/ {
    access_log /var/log/nginx/access.log noquery;   # REST: klucz tylko w X-API-Key, query nie logujemy
    proxy_pass $gateway_upstream;
    proxy_set_header Host $host;
}
location = /health {
    access_log /var/log/nginx/access.log noquery;
    proxy_pass $gateway_upstream;
}
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
