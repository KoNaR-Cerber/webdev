# MediaMTX — wideo

Jeden serwer MediaMTX (`mediamtx` w `docker-compose.yml`, konfiguracja w `mediamtx.yml`) przyjmuje strumienie od
nadawców i rozdaje je przeglądarkom przez WebRTC (WHEP). Nic nie nagrywa i nie transkoduje.

```
robot (kamery)  --SRT :8890 (tylko VPN, bez hasła)-->  MediaMTX  --WHEP /video/<ścieżka>/whep--> Caddy 443 --> przeglądarka
dron DJI        --RTMP :1935 (internet, login+hasło)-->          --RTSP :8554 (opcjonalnie, TCP)--> ffplay / VLC
```

## Ścieżki

| Ścieżka | Nadawca | Wejście | Publikowanie |
|---|---|---|---|
| `video/normal_cam` | robot | SRT | bez hasła, ale tylko z adresów z `ROBOT_PUBLISH_IPS` (`.env`, sieć VPN); poza tym firewall zamyka SRT dla świata |
| `video/IR_cam` | robot | SRT | jak wyżej |
| `video/dji01` | dron DJI Mavic 3M (operator w terenie) | RTMP | login i hasło z `.env` |
| `video/dji01/demo`, `video/normal_cam/demo` | ffmpeg w kontenerze (`mediamtx-demo.sh`, `runOnInit`) | SRT z localhost | tylko z wnętrza kontenera; z zewnątrz odrzucane |

MediaMTX sam nie wymaga uwierzytelnienia do odczytu; dostęp ogranicza Caddy (decyzja z 2026-11-02): ścieżki
Z internetu każda ścieżka, także `*/demo`, tylko z nagłówkiem `X-API-Key` (ten sam klucz co
telemetria, sprawdzany przez gateway przez `forward_auth`), z VPN bez klucza. Demo jest za kluczem od 2026-11-04,
bo nagranie wybrane w panelu może pokazywać wrażliwe miejsca. Prefiks `video/` jest wspólny, bo reverse proxy kieruje `/video/*`
do MediaMTX; dzięki temu nowa ścieżka nie wymaga zmian w Caddy. Preflight CORS (`OPTIONS`) na `/video/*` przechodzi bez klucza,
a Caddy dopisuje `X-API-Key` do `Access-Control-Allow-Headers`, żeby odtwarzacze w przeglądarce z innych originów mogły wysłać klucz.

Lista `ips` we wpisie nr 1 `authInternalUsers` jest jedyną blokadą publikowania bez hasła na kamery robota: RTMP na 1935
jest publiczny i używa tych samych uprawnień, więc bez niej każdy z internetu mógłby podmienić obraz kamery (luka
znaleziona 2026-11-02). Plik ma tylko localhost; sieć VPN dopisuje `.env` przez `ROBOT_PUBLISH_IPS`.

Backend (`/api/*` poza trasami gateway) i dashboard teleoperacji (`/teleop/`) są w Caddy dostępne tylko z VPN: `GET`-y
backendu (`/api/v1/mqtt/gps`, `/api/v1/mqtt/topics`, `/api/v1/ros/status`) nie mają klucza i omijałyby klucz gateway.
Pod `/` jest panel podglądu (`live-panel`, serwis w `docker-compose.yml`): tylko odczyt, z internetu, za hasłem
w przeglądarce (`basic_auth` w Caddy). Panel sam trzyma klucz API i rozmawia z gatewayem oraz MediaMTX po sieci
wewnętrznej, więc przeglądarka obserwatora nie dostaje klucza. Konfiguracja w [live-panel/README.md](../live-panel/README.md).

## Adresy

Dla hosta `cerber.example.org` (przykład) i domyślnych portów:

| Co | Adres |
|---|---|
| nadawanie z drona (RTMP) | `rtmp://cerber.example.org:1935/video/dji01?user=<DJI_PUBLISH_USER>&pass=<DJI_PUBLISH_PASS>` |
| to samo jako URL + klucz strumienia (aplikacje DJI/OBS z dwoma polami) | URL `rtmp://cerber.example.org:1935/video`, klucz `dji01?user=…&pass=…` |
| odtwarzanie w przeglądarce (wbudowany odtwarzacz MediaMTX) | `https://cerber.example.org/video/dji01/` |
| WHEP (własny odtwarzacz, np. `WebRTCCamera.jsx`) | `POST https://cerber.example.org/video/dji01/whep` |
| RTSP do diagnostyki (gdy `RTSP_ENABLE=yes`) | `rtsp://cerber.example.org:18554/video/dji01` (tylko TCP) |

Login i hasło idą w query RTMP, bo aplikacja DJI ma jedno pole na adres. MediaMTX nie loguje query, więc hasło
nie trafia do `docker logs`. Nie przesyłaj tego adresu kanałem, który zostaje w historii (np. publiczny czat).

## Wejścia od robota (tylko VPN)

Robot i serwer są w jednej sieci NetBird; te adresy nie są osiągalne z internetu. `<SERVER_VPN_ADDR>` to adres serwera
w VPN (nie trzymamy go w repo).

| Co | Dokąd | Format |
|---|---|---|
| kamery | `srt://<SERVER_VPN_ADDR>:18890?streamid=publish:video/normal_cam&pkt_size=1316` (analogicznie `video/IR_cam`) | MPEG-TS/H.264 po SRT, bez hasła |
| GPS | MQTT `<SERVER_VPN_ADDR>:11883`, topic `cerber/gps/data` | JSON: `latitude`, `longitude` (stopnie), `date` (ISO 8601 UTC), opcjonalnie `altitude`, `satellites`, `fix_quality` |
| telemetria ROS 2 | robot wystawia rosbridge (WebSocket, port 9090) w VPN; gateway łączy się sam (`ROSBRIDGE_HOST` w `.env`) | tematy: `/imu/data`, `/joint_states`, `/leg_odom2`, `/us_publisher/ultrasound_distance`, `/ptz/status`, `/sensor_status/*_isalive` |

## Strumienie demo

Do pokazów bez sprzętu. Każda ścieżka `video/<kamera>/demo` ma własny proces ffmpeg uruchamiany przez MediaMTX
przy starcie (`runOnInit`, restartowany po awarii). Źródło wybiera `mediamtx-demo.sh`:

- jeśli istnieje `server/media/<kamera>.mp4` (np. `server/media/dji01.mp4`), leci w pętli jako nagranie;
- inaczej obraz testowy (inny wzór dla każdej ścieżki), bez dźwięku.

Odtwarzanie jak każdej innej ścieżki: `https://<host>/video/dji01/demo/` albo `POST /video/dji01/demo/whep`.

Źródło demo w kolejności: nagranie wybrane w panelu (`live-panel`, pierwsza linia `/recordings/demo/<kamera>.path`
w wolumenie `recordings`), plik `server/media/<kamera>.mp4`, obraz testowy. Skrypt sprawdza wskaźnik co 2 s i
restartuje tylko ffmpeg, bez restartu MediaMTX.

## Nagrywanie z panelu

API MediaMTX (`api: yes`, `:9997`) jest włączone wyłącznie w sieci docker, bez portu na hoście, z loginem `panel`
(hasło `MEDIAMTX_API_PASS` w `.env`). Panel ustawia nim `record` na `video/normal_cam`; MediaMTX zapisuje fMP4 bez
transkodowania do `/recordings/mtx/...` (wolumen `recordings`, `pathDefaults.record*` w `mediamtx.yml`), a panel po
zatrzymaniu przenosi plik do katalogu nagrania. Kontener MediaMTX startuje przez `entrypoint` z `chown` wolumenu na
uid 1000, bo panel działa jako `node` i musi przenosić oraz kasować pliki zapisane przez MediaMTX (root).
Włączenie i wyłączenie nagrywania nie przerywa strumienia publishera (sprawdzone na v1.21.3).
Pliki w `server/media/` nie trafiają do repo (`.gitignore`); na serwer wgrywa się je ręcznie. Wymaga obrazu
`bluenviron/mediamtx:latest-ffmpeg`. `DEMO_STREAMS=no` w `.env` wyłącza demo bez zmiany konfiguracji
(procesy tylko śpią). Koszt: jeden enkoder 720p na ścieżkę, ciągle.

## Zmienne w `.env`

| Zmienna | Znaczenie | Domyślnie |
|---|---|---|
| `SRT_PORT`, `WEBRTC_PORT`, `STREAM_PORT`, `WEBRTC_ADDITIONAL_HOSTS` | jak dotąd (SRT, sygnalizacja WHEP, port ICE 1:1, publiczny adres dla ICE) | wymagane |
| `ROBOT_PUBLISH_IPS` | adresy/CIDR-y po przecinku, z których robot publikuje bez hasła na `video/normal_cam` i `video/IR_cam` (wpis nr 1 `authInternalUsers`, `MTX_AUTHINTERNALUSERS_1_IPS`); wpisz sieć VPN | `127.0.0.1,::1` (robot nie opublikuje) |
| `DJI_PUBLISH_USER`, `DJI_PUBLISH_PASS` | login i hasło nadawcy na `video/dji01`; trafiają do wpisu nr 2 `authInternalUsers` przez `MTX_AUTHINTERNALUSERS_2_*` | **wymagane** — compose odmawia startu bez nich |
| `RTMP_PORT` | port RTMP na hoście | `1935` |
| `RTSP_ENABLE` | `yes` włącza nasłuch RTSP (odczyt, tylko TCP) | `no` |
| `RTSP_PORT` | port RTSP na hoście; mapowany zawsze, ale przy `RTSP_ENABLE=no` nic w kontenerze nie słucha | `18554` |
| `DEMO_STREAMS` | `no` wyłącza strumienie `video/*/demo` | `yes` |
| `MEDIAMTX_API_PASS` | hasło użytkownika `panel` do API MediaMTX (wpis nr 5 `authInternalUsers`); panel przełącza nim nagrywanie | **wymagane** |
| `RECORD_MAX_SECONDS`, `RECORD_MAX_BYTES`, `RECORD_KEEP`, `RECORD_TOTAL_BYTES` | limity nagrań z panelu: czas i rozmiar jednego, liczba i łączny rozmiar trzymanych | `600`, `629145600`, `30`, `6442450944` |
| `DEMO_ROBOT_ID` | id robota demo w gatewayu (telemetria z nagrania w pętli) | `cerber-demo` |
| `PANEL_HOSTS` | nazwy hostów (po przecinku), pod którymi przeglądarka otwiera panel podglądu `/`; inny nagłówek `Host` dostaje 403 | `cerber.machinekind.ai` |
| `PANEL_ROBOT_ID` | robot pokazywany w panelu podglądu | `cerber-lite3-01` |
| `PANEL_MAX_VIEWERS` | jednoczesne karty panelu (każda = jedna sesja WHEP) | `8` |

Hasło: coś losowego, np. `openssl rand -base64 24`. Wartości w `mediamtx.yml` (`dji` / `set-in-env`) to zaślepki,
które nadpisuje compose; sprawdzono, że bez nadpisania strumień z tym hasłem jest odrzucany.

## Wdrożenie na serwerze

Stack staging stoi w `/opt/stacks/webdev-staging` (checkout gałęzi `staging` forka) za Caddy spoza repo.
Narzędzia w [scripts/server](../scripts/server/README.md): `deploy-staging.sh` (pobranie gałęzi, `.env`,
`compose up --build`) i `caddy-panel-password.sh` (hasło do panelu podglądu). Wzór naszego vhosta Caddy, z
placeholderami zamiast adresów VPN, jest w [caddy/Caddyfile.example](caddy/Caddyfile.example).

## Firewall serwera

Do tej pory z internetu otwarte były tylko porty Caddy i port ICE (`STREAM_PORT`, TCP+UDP). Dron nadaje z LTE,
więc **`RTMP_PORT`/TCP musi być otwarty publicznie** — stąd hasło. `RTSP_PORT`/TCP otwieraj tylko, gdy RTSP ma być
używane spoza serwera. SRT zostaje zamknięte dla świata (robot nadaje przez VPN), a dodatkowo `ROBOT_PUBLISH_IPS`
ogranicza publikowanie bez hasła do VPN także na publicznym RTMP. MediaMTX nie ma ochrony przed
zgadywaniem haseł; nieudane próby widać w logu jako `failed to authenticate`.

## Testy bez drona

Z dowolnej maszyny z Dockerem (lub lokalnym `ffmpeg`, wtedy bez `docker run … linuxserver/ffmpeg:latest`):

```bash
# nadawanie: kolorowe pasy + ton, 720p30, GOP 2 s (taki sam jak zalecany dla drona)
docker run --rm linuxserver/ffmpeg:latest -re -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 \
  -c:v libx264 -preset ultrafast -tune zerolatency -g 60 -pix_fmt yuv420p -b:v 2000k -c:a aac \
  -f flv "rtmp://cerber.example.org:1935/video/dji01?user=$DJI_PUBLISH_USER&pass=$DJI_PUBLISH_PASS"
```

```bash
# odczyt RTSP (gdy włączone)
docker run --rm linuxserver/ffmpeg:latest -rtsp_transport tcp -i rtsp://cerber.example.org:18554/video/dji01 -frames:v 30 -f null -
```

Potem `https://cerber.example.org/video/dji01/` w przeglądarce. OBS: Ustawienia → Stream → Własny serwer, adres i
klucz z tabeli wyżej.

Zweryfikowane lokalnie (MediaMTX v1.21.3): RTMP z poprawnym hasłem publikuje; złe hasło, zaślepka z `mediamtx.yml`
i brak loginu dostają `authentication failed`; SRT bez hasła z adresu z `ROBOT_PUBLISH_IPS` nadal publikuje na `video/normal_cam`, ale nie na
`video/dji01`; przy `RTSP_ENABLE=no` port 8554 odmawia połączeń, przy `yes` ffmpeg czyta H264+AAC po TCP;
przeglądarka odtwarza `video/dji01` przez WHEP.

## Ograniczenia

- **Bez dźwięku w przeglądarce.** DJI wysyła audio AAC, którego WebRTC nie przenosi; MediaMTX pomija tę ścieżkę
  (`skipping track … MPEG-4 Audio`) i wideo gra normalnie. RTSP ma audio. Gdyby dźwięk w przeglądarce był potrzebny,
  trzeba włączyć HLS (`hls: yes`, port 8888, osobna trasa w Caddy) kosztem kilku sekund opóźnienia.
- **RTMPS nie jest skonfigurowane.** MediaMTX umie (`rtmpEncryption`, port 1936), ale potrzebuje własnego certyfikatu
  i klucza w kontenerze. Jeśli operator drona wymaga RTMPS, trzeba to dołożyć.
- **Parametry strumienia z drona:** H.264, odstęp klatek kluczowych do 2 s (dłuższy opóźnia start obrazu w WebRTC),
  bez B-klatek. Bitrate według łącza LTE operatora.
