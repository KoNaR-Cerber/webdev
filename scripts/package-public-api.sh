#!/usr/bin/env bash
# Handover package for integrators: docs/PUBLIC_API.md + gateway contract (openapi.json, schemas/, examples/).
# Usage: scripts/package-public-api.sh [public-host] [out-dir]
#   defaults: cerber.machinekind.ai, dist   (out-dir relative to the repo root, or absolute)
# The host goes into `servers` of openapi.json; the README already names the public host. Needs python3 and zip.
set -euo pipefail
host=${1:-cerber.machinekind.ai}
out=${2:-dist}
root=$(cd "$(dirname "$0")/.." && pwd)
stamp=$(date -u +%Y-%m-%d)
name="cerber-public-api-$stamp"
work=$(mktemp -d)
trap 'rm -rf "${work:?}"' EXIT

mkdir -p "$work/$name"
cp "$root/docs/PUBLIC_API.md" "$work/$name/README.md"
cp -R "$root/gateway/contract/schemas" "$root/gateway/contract/examples" "$work/$name/"
python3 - "$root/gateway/contract/openapi.json" "$work/$name/openapi.json" "https://$host" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1], encoding="utf-8"))
spec["servers"] = [{"url": sys.argv[3]}]
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(spec, f, indent=2, ensure_ascii=False); f.write("\n")
PY
# nothing from the infrastructure may leave in the package
if grep -rEn "([0-9]{1,3}\.){3}[0-9]{1,3}|duckdns|netbird\.|100\.77\.|example\.org" "$work/$name" | grep -vE "192\.0\.2\.|127\.0\.0\.1|draft/2020-12" ; then
  echo "STOP: package contains an infrastructure address or a placeholder host" >&2; exit 1
fi
case "$out" in /*) outdir="$out" ;; *) outdir="${root:?}/${out:?}" ;; esac
mkdir -p "${outdir:?}"
zipfile="${outdir:?}/${name:?}.zip"
[ -f "$zipfile" ] && rm -f "${zipfile:?}"
(cd "$work" && zip -qr "$zipfile" "$name")
echo "$zipfile"
unzip -l "$zipfile" | awk 'NR>3 && $4 != "" {print "  " $4}' | grep -v "^  ----" | head -40
