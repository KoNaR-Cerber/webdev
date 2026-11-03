# Projekt-Cerber -- sekcja webdev
do zmiany readme

## Panel na żywo

[live-panel](live-panel/README.md) pokazuje wbudowaną kamerę Cerbera, orientację
korpusu, wykresy IMU, pozycje 12 stawów i odometrię z publicznego API. Tylko odczyt.

Na serwerze działa jako serwis `live-panel` z `docker-compose.yml` pod
`https://cerber.machinekind.ai/` (hasło w przeglądarce, nadaje je Caddy).
Dashboard teleoperacji jest pod `https://cerber.machinekind.ai/teleop/` (tylko VPN).

Lokalnie, z własnym kluczem API:

```sh
cd live-panel
test -f .env || cp .env.example .env
# Ustaw CERBER_API_KEY w .env.
npm start
```

Panel działa pod `http://127.0.0.1:8765/`. Wymaga Node.js 24 lub nowszego;
nie wymaga instalowania dodatkowych pakietów. Pełna konfiguracja i opis danych
są w [instrukcji panelu](live-panel/README.md).

## Wdrożenie na Jetsonie

[robot](robot/README.md) zawiera źródła odbiornika telemetrii, ograniczonego
rosbridge i przesyłania wbudowanej kamery, szablony usług systemd oraz opis
trwałej konfiguracji i kopii zapasowych. Parametry urządzeń ustawia się lokalnie.
