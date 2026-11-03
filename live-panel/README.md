# Cerber — kamera i telemetria na żywo

Lokalny panel korzysta z `https://cerber.machinekind.ai` i robota
`cerber-lite3-01`. Pokazuje rzeczywisty strumień kamery oraz dane telemetryczne:

- sztuczny horyzont i kąty roll, pitch, yaw;
- wykresy orientacji, przyspieszenia i prędkości kątowej z ostatnich 60 sekund;
- pozycje 12 stawów, pogrupowane według nóg;
- odometrię, odczyt ultradźwięków, status połączenia i wiek danych;
- GPS: bez pozycji karta pokazuje stan odbiornika z `gps_receiver` („Bez fixu · 3 sat.”,
  „Odbiornik: brak kontaktu od N s”, gdy status starszy niż 20 s), przy pozycji karta z mapą
  (OpenStreetMap, biblioteka Leaflet z CDN unpkg z podpisem SRI) z promieniem
  błędu dla szacunków `source: wifi`. Bez dostępu przeglądarki do internetu mapa
  się nie pokazuje, reszta panelu działa.

Panel służy do podglądu. Nie ma przycisków ani endpointów sterowania robotem.

## Uruchomienie

Wymagany jest Node.js 24 lub nowszy. Serwer korzysta tylko z modułów wbudowanych
w Node; `npm install` nie jest potrzebne.

```sh
cd live-panel
test -f .env || cp .env.example .env
chmod 600 .env
```

W `.env` ustaw swój `CERBER_API_KEY`. Pliki `.env` są ignorowane przez Git.
Jeśli masz już skonfigurowany `.env`, zachowaj go.

```sh
npm start
```

Otwórz **http://127.0.0.1:8765/**. Port można zmienić przez
`CERBER_PANEL_PORT` w `.env`. Serwer nasłuchuje wyłącznie na lokalnym interfejsie
tego komputera. Zatrzymanie: `Ctrl+C` w terminalu z serwerem.

## Przepływ danych

Serwer lokalny utrzymuje jedno połączenie WebSocket do publicznego API i
przekazuje zdarzenia otwartym kartom przez SSE. Klucz pozostaje po stronie
lokalnego procesu: nie trafia do HTML, adresu otwieranej strony ani kodu
przeglądarki. Uwierzytelnienie upstream WebSocket używa parametru wymaganego
przez API; ten adres nie jest wypisywany do logów.

Kamera używa WebRTC/WHEP. Lokalny serwer dołącza klucz do nagłówka żądania
negocjacji z API, a obraz trafia bezpośrednio z serwera mediów do przeglądarki.
Nie zapisujemy nagrań. Po rozłączeniu panel ponawia połączenie.

## Jak czytać dane

- Publiczny strumień API domyślnie wysyła do jednej aktualizacji na sekundę
  dla każdego źródła. Częstotliwość obrazu kamery jest niezależna.
- Dane starsze niż pięć sekund są oznaczane jako nieaktualne. Brakujące pola
  pozostają puste; panel nie generuje zastępczej telemetrii.
- Kąty orientacji i stawów są przeliczane z radianów API na stopnie.
  Oznaczenia pozostałych jednostek wynikają z kontraktu ROS/API; panel nie
  wykonuje kalibracji czujników.
- Odczyt ultradźwięków jest wyświetlany jako wartość surowa, ponieważ kontrakt
  API nie określa jego jednostki.
- Zerowa pozycja lub prędkość odometrii jest prawidłowo pokazana jako zero.
  Nie jest zastępowana komunikatem o braku danych.
- GPS, bateria, PTZ i zbiorcze statusy czujników mogą być niedostępne niezależnie
  od działającej kamery, IMU i stawów.

## Na serwerze (za Caddy)

W `docker-compose.yml` jest serwis `live-panel` (obraz z `Dockerfile`, bez portów na hoście). Dostaje klucz
z `GATEWAY_API_KEY` i rozmawia po sieci wewnętrznej: telemetria z `http://gateway:8000`, sygnalizacja WHEP
z `http://mediamtx:8889`. Obraz (ICE) idzie jak dotąd wprost z MediaMTX do przeglądarki. Caddy kieruje `/`,
`/events`, `/whep`, `/session/*` i `/health-local` do `cerber-<projekt>-live-panel:8765` i nadaje hasło:

```caddyfile
handle {
    basic_auth bcrypt "Cerber" {
        obserwator <hash z: docker exec -i caddy caddy hash-password>
    }
    reverse_proxy cerber-staging-live-panel:8765
}
```

Zmienne serwera (wszystkie poza kluczem opcjonalne):

| Zmienna | Znaczenie | Domyślnie |
|---|---|---|
| `CERBER_API_KEY` | klucz API gatewaya | wymagany |
| `CERBER_API_ORIGIN` | origin API (WebSocket telemetrii) | `https://cerber.machinekind.ai` |
| `CERBER_VIDEO_ORIGIN` | origin MediaMTX (POST/DELETE WHEP) | jak `CERBER_API_ORIGIN` |
| `CERBER_ROBOT_ID` | robot w strumieniu telemetrii | `cerber-lite3-01` |
| `CERBER_PANEL_HOSTS` | nazwy `host[:port]` z przeglądarki (po przecinku); ustawione = nasłuch na `0.0.0.0` | puste (tylko `127.0.0.1:port`) |
| `CERBER_PANEL_BIND` | adres nasłuchu | `0.0.0.0` gdy `CERBER_PANEL_HOSTS`, inaczej `127.0.0.1` |
| `CERBER_PANEL_MAX_VIEWERS` | jednoczesne karty i sesje kamery (1–64) | `8` |
| `CERBER_PANEL_PORT` | port nasłuchu | `8765` |

Żądanie z innym nagłówkiem `Host` lub `Origin` niż z listy dostaje 403. Przejście z linku na innej stronie
(nawigacja) działa; żądania cross-site inne niż nawigacja (fetch, EventSource, formularz) są odrzucane.
Hasło sprawdza Caddy, nie panel; panel ufa, że przed nim stoi tylko reverse proxy.

## Nagrywanie i demo (tylko na serwerze)

Karta „Nagrania" pojawia się, gdy serwer ma `CERBER_RECORDINGS_DIR` (w compose: wolumen `recordings`).
„Rejestruj" włącza nagrywanie kamery `video/normal_cam` w MediaMTX (przez jego API, plik fMP4 bez
transkodowania) i zapis każdej ramki telemetrii z gatewaya do NDJSON (koperty WS, jedna na linię, pierwsza to
snapshot). „Zatrzymaj", limit czasu albo limit rozmiaru kończy nagranie: katalog `<id>/` z `video.mp4`,
`telemetry.ndjson` i `meta.json`, gdzie `<id>` to czas startu UTC (`2026-11-03T10-05-07Z`). Bez nadającej
kamery nagranie ma samą telemetrię.

„Ustaw jako demo" zapisuje dwa pliki-wskaźniki w `demo/`: `normal_cam.path` czyta skrypt demo MediaMTX
(ścieżka `video/normal_cam/demo` odtwarza nagranie w pętli zamiast obrazu testowego), `telemetry.path` czyta
gateway (robot `cerber-demo` odtwarza telemetrię w pętli z czasami przesuniętymi na teraz). Zmiana wyboru działa
bez restartów. Nagranie ustawione jako demo nie podlega rotacji i nie da się go usunąć, dopóki jest demo.

| Zmienna | Znaczenie | Domyślnie |
|---|---|---|
| `CERBER_RECORDINGS_DIR` | katalog nagrań (wspólny wolumen z MediaMTX i gatewayem); brak = karta ukryta | brak |
| `CERBER_MEDIAMTX_API`, `CERBER_MEDIAMTX_USER`, `CERBER_MEDIAMTX_PASS` | API MediaMTX i login z uprawnieniem `api` | `http://mediamtx:9997`, bez loginu |
| `CERBER_RECORD_MAX_SECONDS` | limit czasu jednego nagrania | `300` |
| `CERBER_RECORD_MAX_BYTES` | limit rozmiaru (wideo + telemetria) jednego nagrania | `262144000` (250 MB) |
| `CERBER_RECORD_KEEP` | ile nagrań zostaje (rotacja najstarszych po każdym zatrzymaniu) | `20` |
| `CERBER_RECORD_TOTAL_BYTES` | łączny rozmiar nagrań, powyżej rotacja | `2147483648` (2 GB) |

Endpointy panelu (za tym samym hasłem co podgląd): `GET /recordings` (stan, limity, lista), `POST /recordings`
(start), `POST /recordings/stop`, `POST /recordings/<id>/demo`, `DELETE /recordings/demo`,
`DELETE /recordings/<id>`. Stan idzie też do kart przez SSE jako zdarzenie `recording`.

## Sprawdzenie

```sh
npm test
```

Testy lokalne nie łączą się z robotem. Test całego toru wymaga uruchomionego
robota, działającego odbiornika/rosbridge i strumienia kamery po stronie serwera.

## Pliki

- `public/index.html` — interfejs, wykresy i klient WebRTC;
- `server.mjs` — lokalny serwer, uwierzytelnienie API i przekazywanie zdarzeń;
- `recorder.mjs` — nagrywanie, lista nagrań, wybór demo i rotacja;
- `server.test.mjs`, `recorder.test.mjs` — testy;
- `Dockerfile` — obraz dla serwisu `live-panel` w `docker-compose.yml`;
- `.env.example` — konfiguracja bez credentiali.
