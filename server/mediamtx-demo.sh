#!/bin/sh
# Zrodlo strumienia demo dla sciezki $MTX_PATH (np. video/normal_cam/demo), uruchamiane przez MediaMTX (runOnInit).
# Kolejnosc zrodel: nagranie wybrane w panelu (pierwsza linia /recordings/demo/<nazwa>.path), plik /media/<nazwa>.mp4,
# obraz testowy. Plik-wskaznik jest sprawdzany co 2 s: zmiana wyboru restartuje ffmpeg (chwilowa przerwa w demo),
# bez restartu MediaMTX. DEMO_STREAMS=no wylacza demo bez zmiany konfiguracji (proces tylko spi).
set -u
if [ "${DEMO_STREAMS:-yes}" != "yes" ]; then
  exec sleep infinity
fi
name=$(basename "$(dirname "$MTX_PATH")")   # video/dji01/demo -> dji01
pointer="/recordings/demo/$name.path"
dst="srt://127.0.0.1:8890?streamid=publish:$MTX_PATH&pkt_size=1316"
common="-c:v libx264 -preset ultrafast -tune zerolatency -g 50 -pix_fmt yuv420p -b:v 1200k -an -f mpegts"

source_file() {
  sel=""
  [ -r "$pointer" ] && sel=$(head -n 1 "$pointer")
  if [ -n "$sel" ] && [ -f "$sel" ]; then
    echo "$sel"
  elif [ -f "/media/$name.mp4" ]; then
    echo "/media/$name.mp4"
  fi
}

pid=""
trap 'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi; exit 0' TERM INT

while :; do
  src=$(source_file)
  if [ -n "$src" ]; then
    # nagranie w petli; -re = tempo rzeczywiste
    ffmpeg -nostdin -loglevel warning -re -stream_loop -1 -i "$src" $common "$dst" &
  else
    # obraz testowy, inny wzor dla kazdej sciezki, zeby bylo widac ktore demo to ktore
    case "$name" in
      dji01) gen="testsrc2=size=1280x720:rate=25" ;;
      *)     gen="smptehdbars=size=1280x720:rate=25" ;;
    esac
    ffmpeg -nostdin -loglevel warning -re -f lavfi -i "$gen" $common "$dst" &
  fi
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2
    if [ "$(source_file)" != "$src" ]; then
      kill "$pid" 2>/dev/null
      wait "$pid"
      pid=""
      continue 2
    fi
  done
  wait "$pid"
  exit 1   # ffmpeg padl z innego powodu: MediaMTX uruchamia skrypt ponownie (runOnInitRestart)
done
