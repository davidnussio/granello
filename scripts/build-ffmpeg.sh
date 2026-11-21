#!/usr/bin/env bash
# Compila un ffmpeg ridotto da includere nell'app (sidecar di Tauri): solo audio, licenza LGPL,
# niente librerie esterne. Fa solo quello che serve a Granello: comprimere il WAV in M4A (AAC),
# togliere le pause (silenceremove) e unire le registrazioni (aresample, aformat, concat).
#
#   scripts/build-ffmpeg.sh [target-triple]     # di default quello di rustc
#
# Produce src-tauri/binaries/ffmpeg-<triple>[.exe] e ffmpeg-LICENSE.txt (licenza, versione e
# opzioni di compilazione, come chiede la LGPL). Su Windows va eseguito nella shell MINGW64
# di MSYS2. Cambiando versione o opzioni, cambia anche la chiave della cache in CI (è
# l'hash di questo file).
set -euo pipefail

VERSION=9.0.2
SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
OUT="$ROOT/src-tauri/binaries"
WORK="$ROOT/src-tauri/target/ffmpeg-build"

FLAGS=(
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug
  --disable-ffplay --disable-ffprobe --enable-small
  --enable-protocol=file
  --enable-demuxer=wav,mov
  --enable-decoder=pcm_s16le,pcm_f32le,aac
  --enable-encoder=aac
  --enable-muxer=ipod,mp4
  --enable-filter=silenceremove,aresample,aformat,concat,anull
)
EXE=""
case "$TRIPLE" in
  *apple-darwin)
    # lo stesso minimo dell'app (tauri.conf.json)
    FLAGS+=(--extra-cflags=-mmacosx-version-min=13.0 --extra-ldflags=-mmacosx-version-min=13.0)
    ;;
  *windows*)
    # senza le DLL di MinGW accanto
    FLAGS+=(--extra-ldflags=-static)
    EXE=".exe"
    ;;
esac
# l'assembly x86 chiederebbe nasm: per l'audio non serve
case "$TRIPLE" in x86_64-*) FLAGS+=(--disable-x86asm) ;; esac

mkdir -p "$WORK" "$OUT"
cd "$WORK"
TARBALL="ffmpeg-$VERSION.tar.xz"
if [ ! -f "$TARBALL" ]; then
  curl -sSfLO "https://ffmpeg.org/releases/$TARBALL"
fi
if command -v sha256sum >/dev/null; then
  echo "$SHA256  $TARBALL" | sha256sum -c -
else
  echo "$SHA256  $TARBALL" | shasum -a 256 -c -
fi
rm -rf "ffmpeg-$VERSION"
tar xf "$TARBALL"
cd "ffmpeg-$VERSION"

./configure "${FLAGS[@]}"
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" "ffmpeg$EXE"
cp "ffmpeg$EXE" "$OUT/ffmpeg-$TRIPLE$EXE"

{
  echo "Granello include FFmpeg $VERSION (https://ffmpeg.org), distribuito con la licenza LGPL 2.1"
  echo "o successiva. Sorgente: https://ffmpeg.org/releases/$TARBALL"
  echo "Compilato da scripts/build-ffmpeg.sh (https://github.com/davidnussio/granello) con:"
  echo "  ./configure ${FLAGS[*]}"
  echo
  cat COPYING.LGPLv2.1
} >"$OUT/ffmpeg-LICENSE.txt"

ls -la "$OUT"
