#!/bin/bash
# Wdrozenie na serwer staging: pobiera galaz `staging` z forka do katalogu stacku (git jako wlasciciel katalogu,
# tylko fast-forward - lokalne zmiany w checkoucie przerywaja deploy),
# uzupelnia w .env wartosci, ktore compose wymaga, i przebudowuje wskazane serwisy (domyslnie wszystkie zmienione).
#
#   sudo bash scripts/server/deploy-staging.sh                 # wszystkie serwisy (compose sam pomija niezmienione)
#   sudo bash scripts/server/deploy-staging.sh live-panel      # tylko panel
#   sudo bash scripts/server/deploy-staging.sh frontend         # tylko bundle dashboardu (/teleop/)
#
# Zmienne: STACK (katalog stacku), STACK_USER (wlasciciel checkoutu), GIT_REMOTE, GIT_BRANCH, HOST (do testow).
# Restart mediamtx przerywa na chwile strumienie kamer i demo; restart gatewaya zrywa klientow WS.
set -eu
STACK=${STACK:-/opt/stacks/webdev-staging}
STACK_USER=${STACK_USER:-$(stat -c %U "$STACK")}
GIT_REMOTE=${GIT_REMOTE:-fork}
GIT_BRANCH=${GIT_BRANCH:-staging}
HOST=${HOST:-cerber.machinekind.ai}
ENV_FILE=$STACK/.env
asowner() { runuser -u "$STACK_USER" -- "$@"; }

asowner git -C "$STACK" fetch -q "$GIT_REMOTE" "$GIT_BRANCH"
# tylko fast-forward: reczne zmiany w checkoucie zatrzymuja deploy zamiast zniknac
asowner git -C "$STACK" merge -q --ff-only "$GIT_REMOTE/$GIT_BRANCH"
echo "stack na: $(asowner git -C "$STACK" log --oneline -1)"

# wartosci wymagane przez docker-compose.yml, ktore mozna wygenerowac (nie sa nikomu podawane)
if ! grep -q '^MEDIAMTX_API_PASS=' "$ENV_FILE"; then
  printf '\n# login panelu do API MediaMTX (nagrywanie), wygenerowane %s\nMEDIAMTX_API_PASS=%s\n' \
    "$(date -u +%F)" "$(openssl rand -hex 24)" >> "$ENV_FILE"
  echo "MEDIAMTX_API_PASS dopisane do .env"
fi

docker compose --project-directory "$STACK" up -d --build "$@" 2>&1 | tail -8
if [ $# -eq 0 ] || printf '%s\n' "$@" | grep -qx frontend; then
  echo "czekam na build frontendu..."
  docker wait "$(docker compose --project-directory "$STACK" ps -aq frontend)" >/dev/null
  echo "frontend build: exit $(docker inspect "$(docker compose --project-directory "$STACK" ps -aq frontend)" --format '{{.State.ExitCode}}')"
fi
sleep 3
echo "--- z zewnatrz:"
for p in / /teleop/ /health /docs /video/normal_cam/demo/; do
  curl -sS -m 10 -o /dev/null -w "  $p -> %{http_code}\n" "https://$HOST$p"
done
echo "(oczekiwane: / 401 bez hasla, /teleop/ 403 spoza VPN, reszta 200)"
