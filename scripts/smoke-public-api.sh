#!/bin/bash
# Szybki test publicznych endpointow z zewnatrz (kody HTTP, bez tresci). Bez CERBER_KEY sprawdza tylko to,
# co ma dzialac bez klucza, i czy reszta odmawia.
#   CERBER_KEY=... bash scripts/smoke-public-api.sh            # HOST=... zmienia host
set -u
HOST=${HOST:-https://cerber.machinekind.ai}
KEY=${CERBER_KEY:-}
fail=0
check() {  # check "<opis>" "<oczekiwane kody, po |>" curl-args...
  local label=$1 want=$2; shift 2
  local code; code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo "000")
  if [[ "|$want|" == *"|$code|"* ]]; then printf '  ok    %-52s %s\n' "$label" "$code"
  else printf '  FAIL  %-52s %s (oczekiwane %s)\n' "$label" "$code" "$want"; fail=1; fi
}
H=(-H "X-API-Key: $KEY")
SDP=(-X POST -H 'Content-Type: application/sdp' --data x)

echo "--- bez klucza ($HOST)"
check "/health"                               200 "$HOST/health"
check "/docs"                                 200 "$HOST/docs"
check "/openapi.json"                         200 "$HOST/openapi.json"
check "/ (panel) bez hasla"                   401 "$HOST/"
check "/teleop/ spoza VPN"                    403 "$HOST/teleop/"
check "/api/v1/robots bez klucza"             401 "$HOST/api/v1/robots"
check "/api/v1/robots ze zlym kluczem"        401 -H "X-API-Key: zly" "$HOST/api/v1/robots"
check "/api/v1/mqtt/topics (backend) spoza VPN" 403 "$HOST/api/v1/mqtt/topics"
check "/rosbridge spoza VPN"                  403 "$HOST/rosbridge"
check "demo WHEP POST bez klucza"             401 "${SDP[@]}" "$HOST/video/normal_cam/demo/whep"
check "demo player bez klucza"                401 "$HOST/video/normal_cam/demo/"
check "kamera na zywo WHEP POST bez klucza"   401 "${SDP[@]}" "$HOST/video/normal_cam/whep"
check "demo OPTIONS (preflight CORS)"         204 -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' "$HOST/video/normal_cam/demo/whep"
check "WHIP publish spoza VPN"                403 "${SDP[@]}" "$HOST/video/normal_cam/whip"
check "WHIP publish na demo spoza VPN"        403 "${SDP[@]}" "$HOST/video/normal_cam/demo/whip"

if [ -z "$KEY" ]; then echo "--- CERBER_KEY nie ustawiony, testy z kluczem pominiete"; exit $fail; fi
echo "--- z kluczem"
check "/api/v1/robots"                        200 "${H[@]}" "$HOST/api/v1/robots"
for r in cerber-lite3-01 cerber-demo; do
  check "$r"                                  200 "${H[@]}" "$HOST/api/v1/robots/$r"
  check "$r/telemetry/latest"                 200 "${H[@]}" "$HOST/api/v1/robots/$r/telemetry/latest"
  check "$r/gps/latest (404 = brak pozycji)"  "200|404" "${H[@]}" "$HOST/api/v1/robots/$r/gps/latest"
  check "$r/streams"                          200 "${H[@]}" "$HOST/api/v1/robots/$r/streams"
done
check "nieznany robot"                        404 "${H[@]}" "$HOST/api/v1/robots/nie-ma"
check "demo WHEP POST z kluczem (400 = pusta oferta, klucz OK)" 400 "${H[@]}" "${SDP[@]}" "$HOST/video/normal_cam/demo/whep"
check "dron demo WHEP POST z kluczem"         400 "${H[@]}" "${SDP[@]}" "$HOST/video/dji01/demo/whep"
check "kamera na zywo WHEP z kluczem (404 = nikt nie nadaje)" "400|404" "${H[@]}" "${SDP[@]}" "$HOST/video/normal_cam/whep"
check "IR_cam/demo z kluczem (404: sciezki nie ma w MediaMTX)" "400|404" "${H[@]}" "${SDP[@]}" "$HOST/video/IR_cam/demo/whep"
if command -v websocat >/dev/null; then
  first=$(timeout 8 websocat -n1 "wss://${HOST#https://}/api/v1/robots/cerber-demo/telemetry/stream?api_key=$KEY" 2>/dev/null | head -c 60)
  case "$first" in *snapshot*) echo "  ok    WS cerber-demo: pierwsza ramka snapshot";; *) echo "  FAIL  WS cerber-demo: $first"; fail=1;; esac
else
  echo "  (websocat nie zainstalowany, test WS pominiety)"
fi
[ $fail -eq 0 ] && echo "--- wszystko ok" || echo "--- sa bledy"
exit $fail
