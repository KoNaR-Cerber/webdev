# Cerber — publiczne API robota i drona

Dokument dla zespołów integrujących się z platformą Cerber: telemetria robota (REST + WebSocket) oraz obraz
z kamer robota i drona (WebRTC). Wszystko wychodzi z jednego hosta, tu nazwanego `cerber.example.org`
(w paczce przekazanej zespołowi stoi tu prawdziwa nazwa). Klucz API przekazujemy osobnym kanałem.

```
                        https://cerber.example.org
  /health, /api/v1/robots/*  ──► gateway telemetrii (REST, WS; klucz API)
  /video/<ścieżka>/whep      ──► MediaMTX (WebRTC/WHEP; bez klucza)
  /docs, /openapi.json       ──► dokumentacja interaktywna i kontrakt OpenAPI 3.1
```

Zasady:

- API jest **tylko do odczytu**. Sterowanie robotem i dronem nie jest wystawione i nie będzie przez to API.
- Telemetria wymaga klucza API. Obraz z kamer jest publiczny (bez klucza), bo przeglądarka nie potrafi
  utrzymać sekretu.
- Środowisko to staging przygotowany pod pokazy. Robot jest online tylko w czasie testów i pokazów;
  strumienie `*/demo` działają zawsze, do rozwijania integracji bez sprzętu.
- Kontrakt (`openapi.json`, schematy JSON, przykłady) jest generowany z kodu i wersjonowany razem z nim.
  Zmiany łamiące kontrakt zapowiadamy przed wdrożeniem.

## 1. Klucz API

| Gdzie | Jak |
|---|---|
| REST | nagłówek `X-API-Key: <klucz>` |
| WebSocket | parametr query `?api_key=<klucz>` (przeglądarka nie pozwala ustawić nagłówka) |

Zły lub brakujący klucz: REST → `401 {"detail": "..."}`; WS → połączenie przyjęte i natychmiast zamknięte kodem
`4401`. Klucz nie może trafić do repozytorium, logów ani publicznego czatu; w razie wycieku rotujemy go po
naszej stronie i przekazujemy nowy. Klucza **nie** dopisujcie do adresów REST w query.

## 2. Telemetria robota — REST

Bazowy adres: `https://cerber.example.org`. Identyfikator robota: `cerber-lite3-01` (lista w `/api/v1/robots`).

| Metoda | Ścieżka | Odpowiedź |
|---|---|---|
| GET | `/health` | `Health` — stan gatewaya i jego połączeń z robotem; bez klucza |
| GET | `/api/v1/robots` | `RobotList` |
| GET | `/api/v1/robots/{robot_id}` | `RobotSummary` (`online`, `last_seen`) |
| GET | `/api/v1/robots/{robot_id}/telemetry/latest` | `TelemetrySnapshot` — ostatni znany stan wszystkich źródeł |
| GET | `/api/v1/robots/{robot_id}/gps/latest` | `GPSFix` albo `404`, gdy jeszcze nie było pozycji |
| GET | `/api/v1/robots/{robot_id}/streams` | `VideoStreamList` — adresy WHEP kamer robota |

```bash
export CERBER_KEY=...   # z osobnego kanału
curl -s https://cerber.example.org/health
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.example.org/api/v1/robots
curl -s -H "X-API-Key: $CERBER_KEY" https://cerber.example.org/api/v1/robots/cerber-lite3-01/telemetry/latest
```

`/health` (bez klucza) mówi, czy warto w ogóle pytać o dane:

```json
{"status": "degraded", "version": "1.0.0", "rosbridge_connected": false, "mqtt_connected": true, "ts": 1793605324.49}
```

`status` to `ok`, gdy oba źródła są połączone, inaczej `degraded`. `degraded` z `rosbridge_connected: false`
oznacza po prostu, że robot jest wyłączony lub poza VPN — API odpowiada normalnie, tylko dane ROS się nie
odświeżają.

### Znaczenie pól

- `online` = robot ma otwarte połączenie z gatewayem **i** przysłał cokolwiek w ciągu ostatnich 5 s.
  `last_seen` = czas ostatniej wiadomości z robota (epoch, sekundy, float).
- `TelemetrySnapshot` ma sekcje `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps`, `sensors_alive`
  i dla każdej czas odbioru `*_at`. Sekcja jest `null`, dopóki dane danego typu nie przyszły od startu gatewaya.
  Pole `status` jest wyliczane w chwili odpowiedzi.
- Wszystkie czasy (`ts`, `*_at`, `last_seen`) to czas odbioru przez serwer (epoch), nie zegar robota.
- Jednostki: kąty w radianach, prędkości kątowe rad/s, przyspieszenia m/s², pozycje i prędkości w metrach
  i m/s, `ultrasound` w metrach. GPS: stopnie dziesiętne, wysokość w metrach.
- `battery_percent` jest na razie zawsze `null` (robot nie publikuje stanu baterii).

Przykład (skrócony) `GET /api/v1/robots/cerber-lite3-01/telemetry/latest`:

```json
{
  "robot_id": "cerber-lite3-01",
  "ts": 1761487391.0,
  "imu": {"roll": 0.0, "pitch": 0.0, "yaw": 0.2, "angular_velocity": {"x": 0.0, "y": 0.0, "z": 0.05},
          "linear_acceleration": {"x": 0.1, "y": 0.0, "z": 9.81}, "orientation": {"x": 0, "y": 0, "z": 0.0998, "w": 0.995}},
  "imu_at": 1761487390.996,
  "joints": {"names": ["LF_Joint", "LF_Joint_1", "LF_Joint_2", "..."], "position": [0.0, -0.8, 1.6, "..."]},
  "odometry": {"position": {"x": 12.4, "y": -3.1, "z": 0.33}, "yaw": 0.2, "velocity_body": {"x": 0.5, "y": 0.0, "z": 0.0}, "yaw_rate": 0.05},
  "gps": {"time": "2026-10-26T14:03:11Z", "latitude": 51.107885, "longitude": 17.038538, "altitude": 118.4, "satellites": 9, "fix_quality": 1},
  "status": {"online": true, "last_seen": 1761487390.996, "rosbridge_connected": true, "mqtt_connected": true}
}
```

Pełne przykłady każdego typu są w paczce w `examples/`, schematy w `schemas/`.

### Błędy

| Kod | Kiedy |
|---|---|
| 401 | brak lub zły klucz |
| 404 | nieznany `robot_id`, albo `/gps/latest` zanim przyszła pierwsza pozycja |
| 502 | gateway nie działa (odpowiada reverse proxy); spróbuj ponownie po chwili |

Treść błędu: `{"detail": "..."}` (schemat `Error`).

## 3. Telemetria robota — WebSocket

```
wss://cerber.example.org/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key=<klucz>
```

Serwer wysyła tylko tekstowe ramki JSON w kopercie `TelemetryEventEnvelope`:

```json
{"event": {"type": "gps", "robot_id": "cerber-lite3-01", "ts": 1761487391.0, "data": {"latitude": 51.107885, "longitude": 17.038538, "...": "..."}}}
```

| `type` | `data` | Uwagi |
|---|---|---|
| `snapshot` | `TelemetrySnapshot` | zawsze pierwsza ramka po połączeniu |
| `imu`, `joints`, `odometry`, `ultrasound`, `ptz`, `gps`, `sensors_alive` | odpowiedni model | najwyżej **1 ramka na sekundę na typ**; w oknie wygrywa ostatnia wartość, więc stan końcowy zawsze dochodzi |
| `status` | `RobotStatus` | od razu przy zmianie `online` / `rosbridge_connected` / `mqtt_connected` oraz jako heartbeat **co 5 s** |

Klient nie musi nic wysyłać; ramki od klienta są ignorowane (limit 4096 B, większa = zamknięcie `1009`).
Brak jakiejkolwiek ramki przez ponad ~15 s oznacza zerwane połączenie — połącz się ponownie.

Kody zamknięcia:

| Kod | Znaczenie | Co robić |
|---|---|---|
| 4401 | zły klucz | popraw klucz, nie ponawiaj w pętli |
| 4404 | nieznany `robot_id` | sprawdź `/api/v1/robots` |
| 1013 | limit 20 równoległych połączeń na robota | ponów po kilku sekundach, współdziel jedno połączenie w aplikacji |
| 1011 | klient nie odpowiedział na ping WS (ping co 20 s) | biblioteka WS musi odpowiadać na ping automatycznie (standardowe robią) |
| 1006 / 1008 | klient nie nadążał z odbiorem | czytaj ramki na bieżąco, nie blokuj pętli odbioru |

Ponawianie: wykładniczy backoff od 1 s do 30 s. Nie otwierajcie wielu połączeń na jednego użytkownika —
jedno połączenie na aplikację i rozgłaszanie wewnątrz.

Minimalny klient (Python, `pip install websockets`):

```python
import asyncio, json, os, websockets

URL = f"wss://cerber.example.org/api/v1/robots/cerber-lite3-01/telemetry/stream?api_key={os.environ['CERBER_KEY']}"

async def main():
    async with websockets.connect(URL) as ws:
        async for raw in ws:
            ev = json.loads(raw)["event"]
            print(ev["type"], ev["ts"], ev["data"] if ev["type"] != "snapshot" else "(snapshot)")

asyncio.run(main())
```

W przeglądarce: `new WebSocket(url)` i `JSON.parse(e.data).event` w `onmessage`. Klucz w adresie WS jest
widoczny w narzędziach deweloperskich, więc aplikacje publiczne powinny trzymać WS po swojej stronie
(backend-proxy), a do przeglądarki wysyłać własny strumień.

## 4. Obraz z kamer — WebRTC (WHEP)

Odtwarzanie jest publiczne i nie wymaga klucza. Każda kamera to ścieżka MediaMTX pod `/video/`:

| Ścieżka | Źródło | Dostępność |
|---|---|---|
| `video/normal_cam` | kamera RGB robota | gdy robot nadaje |
| `video/IR_cam` | kamera termowizyjna robota | gdy robot nadaje |
| `video/dji01` | dron DJI Mavic 3M | gdy operator nadaje |
| `video/normal_cam/demo` | obraz testowy / nagranie w pętli | zawsze |
| `video/dji01/demo` | obraz testowy / nagranie w pętli | zawsze |

Dwa sposoby odtwarzania:

1. **Wbudowany odtwarzacz** (do szybkiego podglądu, także w `<iframe>`):
   `https://cerber.example.org/video/dji01/demo/`
2. **WHEP** we własnej aplikacji: `POST https://cerber.example.org/video/<ścieżka>/whep`
   - żądanie: `Content-Type: application/sdp`, w treści oferta SDP (`recvonly`);
   - odpowiedź `201`: treść to odpowiedź SDP, nagłówek `Location` to adres sesji;
   - zakończenie: `DELETE <Location>` (inaczej sesja wygasa sama po kilkunastu sekundach bez ruchu);
   - `404`, gdy nikt aktualnie nie nadaje na tej ścieżce — ponawiajcie z backoffem (2 s → 30 s), nie co sekundę.

```js
async function playWhep(video, path) {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.ontrack = (e) => { video.srcObject = e.streams[0]; };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch(`https://cerber.example.org/${path}/whep`, {
    method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp,
  });
  if (res.status === 404) throw new Error("no stream");           // nikt nie nadaje
  const session = new URL(res.headers.get("Location"), res.url);  // do DELETE przy zamykaniu
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  return () => { fetch(session, { method: "DELETE", keepalive: true }); pc.close(); };
}
playWhep(document.querySelector("video"), "video/dji01/demo");
```

Wymagania sieciowe po stronie klienta: oprócz HTTPS/443 ruch mediów idzie **UDP lub TCP na port 18189**
serwera (kandydaci ICE wskazują publiczny adres serwera, STUN/TURN nie jest potrzebny). Sieci firmowe
blokujące UDP wychodzący działają po TCP, z nieco większym opóźnieniem.

Format: H.264, bez dźwięku w przeglądarce (dron nadaje AAC, którego WebRTC nie przenosi). Zapis, HLS
i RTSP nie są publicznie dostępne.

`GET /api/v1/robots/{robot_id}/streams` zwraca te same adresy WHEP dla kamer robota, żeby aplikacja nie
musiała ich mieć na sztywno (`whep_url` jest względny do hosta API). Pole `vpn_only` to flaga konfiguracji,
nie stan sieci; obecnie `false`.

## 5. Nadawanie obrazu (dla dostawców źródeł)

### Dron DJI — RTMP z internetu

| | |
|---|---|
| adres | `rtmp://cerber.example.org:1935/video/dji01?user=<login>&pass=<hasło>` |
| aplikacje z dwoma polami (DJI Fly / Pilot, OBS) | URL `rtmp://cerber.example.org:1935/video`, klucz strumienia `dji01?user=<login>&pass=<hasło>` |
| kodek | H.264, odstęp klatek kluczowych ≤ 2 s, bez B-klatek; bitrate według łącza LTE |
| dźwięk | przyjmowany, ale nie trafia do przeglądarki |

Login i hasło przekazujemy osobno; jedno nadawanie na raz (drugi nadawca na tę samą ścieżkę jest odrzucany).
RTMPS nie jest obecnie skonfigurowane. Test bez drona (dowolna maszyna z ffmpeg):

```bash
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 60 -pix_fmt yuv420p -b:v 2000k -an -f flv "rtmp://cerber.example.org:1935/video/dji01?user=$U&pass=$P"
```

### Robot — tylko przez VPN

Robot i serwer są w jednej sieci VPN (NetBird). Poniższe adresy nie są dostępne z internetu; adres serwera
w VPN (`<SERVER_VPN_ADDR>`) i zaproszenie do sieci przekazujemy osobno.

| Co | Dokąd | Format |
|---|---|---|
| kamery | `srt://<SERVER_VPN_ADDR>:18890?streamid=publish:video/normal_cam&pkt_size=1316` (analogicznie `video/IR_cam`) | MPEG-TS/H.264 po SRT, bez hasła |
| GPS | MQTT `<SERVER_VPN_ADDR>:11883`, topic `cerber/gps/data` | JSON: `latitude`, `longitude` (stopnie), `date` (ISO 8601 UTC), opcjonalnie `altitude`, `satellites`, `fix_quality` |
| telemetria ROS 2 | robot wystawia rosbridge (WebSocket, port 9090) w VPN; gateway sam się do niego łączy | tematy: `/imu/data`, `/joint_states`, `/leg_odom2`, `/us_publisher/ultrasound_distance`, `/ptz/status`, `/sensor_status/*_isalive` |

## 6. Kontrakt i paczka

Zawartość paczki `cerber-public-api-<data>.zip`:

| Plik | Co to |
|---|---|
| `README.md` | ten dokument z prawdziwą nazwą hosta |
| `openapi.json` | OpenAPI 3.1 gatewaya z polem `servers`; strumień WS opisany w rozszerzeniu `x-websockets` (OpenAPI nie ma natywnego opisu WS) |
| `schemas/*.json` | JSON Schema (draft 2020-12) każdego modelu, do walidacji w CI klienta |
| `examples/*.json` | przykładowe odpowiedzi REST i ramki WS, zwalidowane schematami |

To samo na żywo: `https://cerber.example.org/openapi.json` (kontrakt) i `https://cerber.example.org/docs`
(Swagger UI, można wykonać żądanie z kluczem przyciskiem *Authorize*). Generowanie klienta, np.
`openapi-generator-cli generate -i openapi.json -g typescript-fetch -o client/`.

Kontrakt wideo (WHEP) to standard IETF (draft-ietf-wish-whep) w implementacji MediaMTX i nie jest częścią
`openapi.json`.

## 7. Limity i dobre praktyki

- REST: odpytywanie `/telemetry/latest` częściej niż raz na sekundę nie ma sensu (dane i tak nie zmieniają
  się częściej niż throttling WS). Do danych na żywo używajcie WS.
- WS: 20 połączeń na robota łącznie dla wszystkich integracji. Jedno połączenie na aplikację.
- WHEP: każdy widz to osobna sesja WebRTC po stronie serwera; przy pokazach z wieloma widzami dajcie znać
  wcześniej.
- Dostępność: bez SLA; to środowisko demonstracyjne. Stan serwera sprawdza `/health`, stan robota pole
  `online`. Planowane przerwy ogłaszamy z wyprzedzeniem.

## 8. Kontakt i zgłaszanie problemów

Zgłoszenia z adresem, czasem (UTC), kodem odpowiedzi/zamknięcia WS i, jeśli to możliwe, fragmentem
odpowiedzi — kanałem ustalonym przy przekazaniu klucza. Klucza i haseł nie wklejajcie do zgłoszeń.
