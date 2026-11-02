#!/usr/bin/env bash
# Paczka dla zespołów integrujących: docs/PUBLIC_API.md + kontrakt gatewaya (openapi.json, schemas/, examples/).
# Użycie: scripts/package-public-api.sh <publiczny-host> [katalog-wyjściowy (względny do repo albo bezwzględny)]
#   np. scripts/package-public-api.sh cerber.example.org dist
# W README i w `servers` OpenAPI zastępuje `cerber.example.org` podaną nazwą. Wymaga tylko python3 i zip.
set -euo pipefail
host=${1:?podaj publiczna nazwe hosta, np. cerber.example.org}
out=${2:-dist}
root=$(cd "$(dirname "$0")/.." && pwd)
stamp=$(date -u +%Y-%m-%d)
name="cerber-public-api-$stamp"
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT

mkdir -p "$work/$name"
sed "s/cerber\.example\.org/$host/g" "$root/docs/PUBLIC_API.md" > "$work/$name/README.md"
cp -R "$root/gateway/contract/schemas" "$root/gateway/contract/examples" "$work/$name/"
python3 - "$root/gateway/contract/openapi.json" "$work/$name/openapi.json" "https://$host" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1], encoding="utf-8"))
spec["servers"] = [{"url": sys.argv[3]}]
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(spec, f, indent=2, ensure_ascii=False); f.write("\n")
PY
# nic z infrastruktury nie może wyjść w paczce
if grep -rEn "([0-9]{1,3}\.){3}[0-9]{1,3}|duckdns|netbird\.|100\.77\." "$work/$name" | grep -vE "192\.0\.2\.|127\.0\.0\.1|draft/2020-12" ; then
  echo "STOP: paczka zawiera adres infrastruktury" >&2; exit 1
fi
case "$out" in /*) outdir="$out" ;; *) outdir="${root:?}/${out:?}" ;; esac
mkdir -p "${outdir:?}"
zipfile="${outdir:?}/${name:?}.zip"
[ -f "$zipfile" ] && rm -f "${zipfile:?}"
(cd "$work" && zip -qr "$zipfile" "$name")
echo "$zipfile"
unzip -l "$zipfile" | awk 'NR>3 && $4 != "" {print "  " $4}' | grep -v "^  ----" | head -40
