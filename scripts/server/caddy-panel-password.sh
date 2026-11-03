#!/bin/bash
# Ustawia lub zmienia haslo do panelu podgladu (basic_auth w Caddy, blok `handle` z reverse_proxy do live-panel).
# Pyta o login i haslo, hashuje je w kontenerze Caddy (bcrypt), robi kopie Caddyfile, waliduje i przeladowuje.
#
#   sudo bash scripts/server/caddy-panel-password.sh            # ustaw / zmien
#   sudo bash scripts/server/caddy-panel-password.sh rollback   # przywroc ostatnia kopie
#
# Zmienne: CADDYFILE (sciezka na hoscie), CADDY_CONTAINER, HOST (do testu).
set -euo pipefail
CADDYFILE=${CADDYFILE:-/opt/infra/caddy/server/Caddyfile}
CADDY_CONTAINER=${CADDY_CONTAINER:-caddy}
HOST=${HOST:-cerber.machinekind.ai}
BAK=$CADDYFILE.bak-panel-password
reload() {
  docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null && echo "validate: ok"
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile 2>&1 | grep -vE "not formatted|header_up" | tail -1
}
if [ "${1:-}" = "rollback" ]; then
  [ -f "$BAK" ] || { echo "brak kopii $BAK"; exit 1; }
  cat "$BAK" > "$CADDYFILE"; reload; echo "rollback: ok"; exit 0
fi
grep -q 'basic_auth' "$CADDYFILE" || { echo "w $CADDYFILE nie ma bloku basic_auth (wzor: server/caddy/Caddyfile.example)"; exit 1; }
read -rp "login do panelu [obserwator]: " USER_NAME; USER_NAME=${USER_NAME:-obserwator}
read -rsp "haslo do panelu: " PW; echo
read -rsp "powtorz haslo: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "hasla sie roznia"; exit 1; }
HASH=$(printf '%s\n' "$PW" | docker exec -i "$CADDY_CONTAINER" caddy hash-password 2>/dev/null | tail -1)
case "$HASH" in '$2'*) ;; *) echo "caddy hash-password nie zwrocil hasha bcrypt"; exit 1;; esac
cp "$CADDYFILE" "$BAK"; echo "kopia: $BAK"
# podmienia pierwsza linie `<login> <hash>` wewnatrz pierwszego bloku basic_auth
USER_NAME="$USER_NAME" HASH="$HASH" python3 - "$CADDYFILE" <<'PY'
import os, re, sys
path = sys.argv[1]
s = open(path, encoding="utf-8").read()
m = re.search(r"(basic_auth[^\n]*\{\n)(\s*)(\S+ \S+)(\n)", s)
if not m:
    sys.exit("nie znaleziono linii login+hash w bloku basic_auth")
s = s[:m.start(3)] + f'{os.environ["USER_NAME"]} {os.environ["HASH"]}' + s[m.end(3):]
open(path, "w", encoding="utf-8").write(s)
PY
reload
sleep 1
curl -sS -m 10 -o /dev/null -w "  / bez hasla -> %{http_code} (401)\n" "https://$HOST/"
curl -sS -m 10 -o /dev/null -w "  / z haslem  -> %{http_code} (200)\n" -u "$USER_NAME:$PW" "https://$HOST/"
unset PW PW2
