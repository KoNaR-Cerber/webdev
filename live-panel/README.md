# Cerber — kamera i telemetria na żywo

Lokalny panel korzysta z `https://cerber.machinekind.ai` i robota
`cerber-lite3-01`. Pokazuje rzeczywisty strumień kamery oraz dane telemetryczne:

- sztuczny horyzont i kąty roll, pitch, yaw;
- wykresy orientacji, przyspieszenia i prędkości kątowej z ostatnich 60 sekund;
- pozycje 12 stawów, pogrupowane według nóg;
- odometrię, odczyt ultradźwięków, status połączenia i wiek danych;
- GPS oraz stan baterii, jeśli API dostarcza te pola.

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

## Sprawdzenie

```sh
npm test
```

Testy lokalne nie łączą się z robotem. Test całego toru wymaga uruchomionego
robota, działającego odbiornika/rosbridge i strumienia kamery po stronie serwera.

## Pliki

- `public/index.html` — interfejs, wykresy i klient WebRTC;
- `server.mjs` — lokalny serwer, uwierzytelnienie API i przekazywanie zdarzeń;
- `server.test.mjs` — testy serwera;
- `Dockerfile` — obraz dla serwisu `live-panel` w `docker-compose.yml`;
- `.env.example` — konfiguracja bez credentiali.
