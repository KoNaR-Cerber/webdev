#!/usr/bin/env bash
# Fetch only the pinned upstream source archive; do not build or deploy anything.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
archive=rosbridge_suite-54868a228d8c05cc60cb85d6e4813a3271283e31.tar.gz
expected=383cb4acb444bbbd877639b348e49bf9512dd3b6a1803b0707d53668c046120f
verify() {
  python3 - "$1" "$expected" <<'PY'
import hashlib, pathlib, sys
if hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() != sys.argv[2]:
    raise SystemExit('Pinned rosbridge source checksum mismatch')
PY
}
if [[ -e "$archive" ]]; then
  verify "$archive"
  exit 0
fi
staged=$(mktemp "${archive}.download.XXXXXX")
trap 'rm -f -- "$staged"' EXIT
curl --fail --location --proto '=https' --proto-redir '=https' \
  'https://codeload.github.com/RobotWebTools/rosbridge_suite/tar.gz/54868a228d8c05cc60cb85d6e4813a3271283e31' \
  --output "$staged"
verify "$staged"
mv -- "$staged" "$archive"
