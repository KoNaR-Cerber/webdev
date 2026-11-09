# Skrypty serwerowe

Uruchamiane na serwerze z `sudo` (compose i Caddy wymagają roota; checkout stacku ma innego właściciela i git
działa jako on). Nie zawierają adresów ani haseł: wszystko bierze się z `.env` stacku albo z promptu.

| Skrypt | Co robi |
|---|---|
| `deploy-staging.sh [serwis…]` | `git fetch` + `merge --ff-only` z `fork/staging` w katalogu stacku (ręczne zmiany w checkoucie zatrzymują deploy, nie znikają), dopisuje do `.env` brakujące wartości, które da się wygenerować (`MEDIAMTX_API_PASS`), `docker compose up -d --build` wskazanych serwisów (bez argumentów: wszystkich), czeka na build frontendu, sprawdza kody odpowiedzi z zewnątrz |
| `caddy-panel-password.sh [rollback]` | pyta o login i hasło panelu podglądu, hashuje w kontenerze Caddy (`caddy hash-password`), podmienia linię w bloku `basic_auth`, waliduje i przeładowuje; kopia `Caddyfile.bak-panel-password` |

Zmienne (opcjonalne): `STACK`, `STACK_USER`, `GIT_REMOTE`, `GIT_BRANCH`, `HOST`, `CADDYFILE`, `CADDY_CONTAINER`.

Caddy nie jest częścią stacku: jego konfiguracja leży poza repo, a wzór naszego vhosta (z placeholderami
`<VPN_CIDR>`, `<ROBOT_VPN_IP>`, `<ACME_EMAIL>`, `<PANEL_LOGIN> <BCRYPT_HASH>`) to
[server/caddy/Caddyfile.example](../../server/caddy/Caddyfile.example). Jednorazowe łatki Caddy z wcześniejszych
wdrożeń (2026-10-30 do 2026-11-03) nie są tu przechowywane; wynik tych zmian to właśnie ten wzór.

Typowy przebieg po merge do `staging`:

```sh
cd /opt/stacks/webdev-staging && sudo bash scripts/server/deploy-staging.sh live-panel
```
