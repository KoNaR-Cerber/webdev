# Serwer: co leży poza repo i co posprzątać

Stan z 2026-11-09. Dotyczy serwera stagingowego, na którym stoi stack `/opt/stacks/webdev-staging` za Caddy.
Adresów, nazw hostów infrastruktury i haseł w tym pliku nie ma. Są w `.env` stacku i w żywym Caddyfile na serwerze.

## Stack staging

Checkout w `/opt/stacks/webdev-staging` jest na gałęzi `staging` forka i nie ma lokalnych zmian.
Poza repo leżą tylko dwie rzeczy:

- `.env` ze wszystkimi zmiennymi, których wymaga `docker-compose.yml`. Plik jest w `.gitignore`.
- `server/influxdb/` z danymi InfluxDB. Katalog jest w `.gitignore`.

Nie ma pliku `docker-compose.override.yml`. Obrazy `live-panel` i `gateway` pochodzą z ostatniego commita na
`staging`. Backend, mosquitto i InfluxDB nie zmieniły się od 2026-10-31 i nie wymagały przebudowy.

## Caddy

Caddy nie jest częścią stacku. Jego konfiguracja leży w `/opt/infra/caddy/server/Caddyfile` i obsługuje też cudze
vhosty na tym serwerze. Wzór naszego vhosta jest w [server/caddy/Caddyfile.example](../server/caddy/Caddyfile.example).

Nasz vhost na serwerze różni się od wzoru tylko wypełnionymi placeholderami: siecią VPN, adresem rosbridge robota,
adresem e-mail do ACME oraz loginem i hashem hasła panelu. Logika tras jest identyczna.

Tylko na serwerze, poza wzorem, są:

- vhosty infrastruktury: Dockge i NetBird;
- blok prod, który kieruje do nieistniejącego kontenera `cerber-prod-backend`;
- trzy nazwy hostów, które importują ten sam snippet staging: nazwa w DNS na adres VPN, stara nazwa publiczna i
  `cerber.machinekind.ai`.

W katalogu Caddy leży 13 kopii zapasowych `Caddyfile.bak-*` z łatek z okresu 2026-10-30 do 2026-11-04 i cztery
pliki robocze `Caddyfile.new*`. Żadna łatka już z nich nie korzysta.

## Skrypty w `/tmp`

W `/tmp` leży 20 skryptów z wdrożeń od 2026-10-30 do 2026-11-04. Każdy powstał w sesji Claude Code na laptopie,
był kopiowany na serwer przez `scp` i uruchamiany przez `sudo bash`. Skrypty Caddy robiły kopię zapasową Caddyfile i
miały tryb `rollback`. Skrypty deploy robiły `git reset --hard fork/staging` w katalogu stacku i `docker compose up
-d --build` wybranych serwisów.

Wszystkie są jednorazowe i zastąpione. Łatki Caddy złożyły się na `Caddyfile.example`. Skrypty deploy zastąpił
`scripts/server/deploy-staging.sh`, który robi `merge --ff-only` zamiast `reset --hard`. Patch hasła panelu zastąpił
`scripts/server/caddy-panel-password.sh`. `/tmp` znika przy restarcie serwera.

| Skrypt | Data | Co zrobił | Skąd się wziął |
|---|---|---|---|
| `apply_caddy.sh` | 2026-10-30 | Naprawił vhost staging: `try_files` przepisywał `/api/*` na `index.html`, zanim trafiło do backendu. | audyt serwera 2026-10-30 |
| `switch_staging.sh` | 2026-10-31 | Przełączył stack z upstream `master` na `staging` forka, dopisał zmienne gateway i wideo do `.env`, zdjął testowe kontenery z katalogu domowego. | start obecnego workflow |
| `redeploy_frontend.sh` | 2026-10-31 | Przebudował sam frontend po pushu na `staging`. | pierwszy skrypt deploy |
| `apply_caddy2.sh`, `apply_caddy3.sh`, `apply_caddy4.sh` | 2026-10-31 | Kolejne iteracje tras gateway i wideo w Caddy. | upstream PR #1 i #2 |
| `apply_caddy5.sh` | 2026-10-31 | Zablokował WHIP i `POST` do backendu spoza VPN. | hardening po PR #2 |
| `deploy_dji.sh` | 2026-11-01 | Wdrożył RTMP dla drona DJI: dane nadawcy w `.env`, przebudowa MediaMTX. | fork PR #3 |
| `finish_teleop.sh` | 2026-11-01 | `ROSBRIDGE_HOST` dla backendu i trasa `/rosbridge` tylko z VPN. | fork PR #1 |
| `deploy_demo.sh` | 2026-11-01 | Strumienie demo: MediaMTX w wariancie z ffmpeg. | strumienie demo |
| `deploy_public_api.sh` | 2026-11-02 | `GATEWAY_PUBLIC_URL` w `.env` i przebudowa gatewaya. | fork PR #3, dokumentacja API |
| `apply_caddy7.sh` | 2026-11-02 | Dodał host `cerber.machinekind.ai` z tym samym zestawem tras. | zmiana adresu publicznego |
| `apply_caddy8.sh` | 2026-11-02 | Dashboard SPA tylko z VPN. | decyzja po tym, jak panel teleop okazał się publiczny |
| `apply_caddy9.sh` | 2026-11-02 | Wariant z wideo tylko z VPN. Nigdy nie uruchomiony. | odrzucony wariant |
| `apply_caddy10.sh` | 2026-11-02 | Wideo publiczne za kluczem API przez `forward_auth` do gatewaya. | model dostępu do wideo |
| `apply_fix11.sh` | 2026-11-02 | Luki z audytu: publikowanie bez hasła tylko z VPN, backend `/api/*` tylko z VPN, CORS dla `X-API-Key`. | fork PR #4 |
| `deploy_live_panel.sh`, `apply_caddy12.sh` | 2026-11-03 | Panel podglądu pod `/` z `basic_auth`, dashboard pod `/teleop/`. | fork PR z live-panel |
| `deploy_recording.sh` | 2026-11-03 | Nagrywanie z panelu: `MEDIAMTX_API_PASS` w `.env`, przebudowa mediamtx, gateway i live-panel. | fork PR z nagrywaniem |
| `apply_caddy13.sh` | 2026-11-04 | Demo wideo za kluczem API, tak jak kamery na żywo. | fork PR #18 |

## Poza naszym stackiem

- `/opt/stacks/webdev-prod` jest checkoutem upstream `master`. Stack nie działa.
- Trzy kontenery Coolify stoją zatrzymane od dwóch tygodni z `restart: always`. Do tego jeden zatrzymany kontener
  testowy sprzed pół roku.
- Wolumeny `cerber-project_*` zostały po starym stacku. Caddy używa z nich tylko `cerber-project_frontend-dist`
  do serwowania frontendu prod. Dane Grafany i Prometheusa nikt nie czyta.

To nie jest nasza infrastruktura. Przed kasowaniem trzeba to uzgodnić z właścicielem serwera.

## Dane runtime

Wolumen `cerber-staging_recordings` trzyma nagrania z panelu i wskaźniki demo (`demo/telemetry.path`,
`demo/normal_cam.path`). To stan aplikacji. Rotację robi panel.

## Czego nie sprawdzono

Reguły ufw i `DOCKER-USER` oraz crontab roota wymagają `sudo`. Ostatni audyt z 2026-11-02 pokazał, że z internetu
otwarte są tylko porty 22, 80, 443, 1935, 8443 i 18189.

## Lista sprzątania

Wszystko poniżej jest odwracalne albo dotyczy plików, których nic nie używa.

1. Skasować skrypty w `/tmp`. Należą do użytkownika `marcin`, `sudo` nie jest potrzebne.

   ```bash
   rm /tmp/apply_caddy*.sh /tmp/apply_fix11.sh /tmp/deploy_*.sh /tmp/finish_teleop.sh /tmp/redeploy_frontend.sh /tmp/switch_staging.sh
   ```

2. Skasować pliki robocze Caddy i stare kopie zapasowe. Zostawić najnowszą kopię (`Caddyfile.bak-2026-11-04-demo-key`).

   ```bash
   cd /opt/infra/caddy/server && sudo rm Caddyfile.new* Caddyfile.bak-2026-10-3* Caddyfile.bak-2026-11-0[123]*
   ```

3. Uzgodnić z właścicielem serwera usunięcie kontenerów Coolify i wolumenów `cerber-project_grafana-data` oraz
   `cerber-project_prometheus-data`.

4. Zdecydować, co z blokiem prod w Caddy i katalogiem `/opt/stacks/webdev-prod`. Dziś host prod odpowiada błędem
   502, bo wskazuje na kontener, którego nie ma.

Od tej pory zmiany na serwerze idą przez skrypty z [scripts/server](../scripts/server/README.md). Nowych plików w
`/tmp` nie zostawiamy.
