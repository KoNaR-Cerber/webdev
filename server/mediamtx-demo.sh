#!/bin/sh
# Zrodlo strumienia demo dla sciezki $MTX_PATH (np. video/normal_cam/demo), uruchamiane przez MediaMTX (runOnInit).
# Kolejnosc zrodel: nagrania wybrane w panelu (linie /recordings/demo/<nazwa>.path: jedna = jedno nagranie w petli,
# kilka = playlista po kolei w petli, najwyzej 5), plik /media/<nazwa>.mp4, obraz testowy. Plik-wskaznik jest
# sprawdzany co 2 s: zmiana wyboru restartuje ffmpeg (chwilowa przerwa w demo), bez restartu MediaMTX.
# DEMO_STREAMS=no wylacza demo bez zmiany konfiguracji (proces tylko spi).
set -u
if [ "${DEMO_STREAMS:-yes}" != "yes" ]; then
  exec sleep infinity
fi
name=$(basename "$(dirname "$MTX_PATH")")   # video/dji01/demo -> dji01
pointer="/recordings/demo/$name.path"
dst="srt://127.0.0.1:8890?streamid=publish:$MTX_PATH&pkt_size=1316"
common="-c:v libx264 -preset ultrafast -tune zerolatency -g 50 -pix_fmt yuv420p -b:v 1200k -an -f mpegts"

# istniejace pliki z wskaznika (w kolejnosci, max 5), kazdy w osobnej linii; bez nich plik /media
source_file() {
  found=""
  if [ -r "$pointer" ]; then
    found=$(head -n 5 "$pointer" | while IFS= read -r sel; do
      [ -n "$sel" ] && [ -f "$sel" ] && echo "$sel"
    done)
  fi
  if [ -n "$found" ]; then
    echo "$found"
  elif [ -f "/media/$name.mp4" ]; then
    echo "/media/$name.mp4"
  fi
}

# lista dla demuxera concat (playlista); sciezki bez apostrofow (nazwy nagran to znaczniki czasu)
playlist="/tmp/demo-$name.txt"
write_playlist() {
  printf '%s\n' "$1" | sed "s|^|file '|; s|\$|'|" > "$playlist"
}

pid=""
trap 'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi; exit 0' TERM INT

while :; do
  src=$(source_file)
  if [ -n "$src" ] && [ "$(printf '%s\n' "$src" | grep -c .)" -gt 1 ]; then
    # playlista: nagrania po kolei, calosc w petli; -re = tempo rzeczywiste
    write_playlist "$src"
    ffmpeg -nostdin -loglevel warning -re -stream_loop -1 -f concat -safe 0 -i "$playlist" $common "$dst" &
  elif [ -n "$src" ]; then
    # jedno nagranie w petli
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
