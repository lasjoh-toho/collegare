#!/usr/bin/env bash
# Holt die Folien-Oberfläche aus Bento (lasjoh-toho/bento, MIT) und den PowerPoint-Import aus mod_bento
# (bentoconvert.js, nicht-kommerziell wie der Kern, siehe LIZENZEN.md) in festen Ständen nach client/public/bento/:
#   Bento_Slides.bento.html   gebaute Ein-Datei-Oberfläche; der Server setzt die Präsentation hinein
#   bentoconvert.js           PPTX/PPT → Bento-JSON, nur der Umwandlungsteil (ohne Moodle-Oberfläche)
#   scripts/bento-holen.sh                 Stände aus scripts/bento.ref und scripts/bentoconvert.ref
#   BENTO_SRC=/pfad/zu/bento …             Bento aus einem vorhandenen Ordner statt von GitHub
#   BENTOCONVERT_SRC=/pfad/zu/mod_bento …  ebenso für mod_bento
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$(tr -d '[:space:]' < "$ROOT/scripts/bento.ref")"
CREF="$(tr -d '[:space:]' < "$ROOT/scripts/bentoconvert.ref")"
DEST="$ROOT/client/public/bento"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

holen() { # <repo> <ref> <ziel>
  git -C "$TMP" init -q "$3"
  git -C "$TMP/$3" fetch -q --depth 1 "https://github.com/lasjoh-toho/$1" "$2"
  git -C "$TMP/$3" checkout -q FETCH_HEAD
}

if [[ -n "${BENTO_SRC:-}" ]]; then SRC="$BENTO_SRC"; else holen bento "$REF" bento; SRC="$TMP/bento"; fi
# ohne mod_bento (z. B. kein Lesezugriff) fehlt nur der PowerPoint-Import; die Folien-Seite meldet das dann
if [[ -n "${BENTOCONVERT_SRC:-}" ]]; then CSRC="$BENTOCONVERT_SRC"
elif holen moodle-mod_bento "$CREF" mod_bento; then CSRC="$TMP/mod_bento"
else CSRC=""; echo "Warnung: mod_bento nicht erreichbar, PowerPoint-Import fehlt" >&2; fi

( cd "$SRC/slides" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build:single )

rm -rf "$DEST"
mkdir -p "$DEST"
cp "$SRC/slides/dist-single/Bento_Slides.bento.html" "$DEST/"
cp "$SRC/LICENSE" "$DEST/LICENSE-bento"
if [[ -n "$CSRC" ]]; then
# nur der Umwandlungsteil: alles vor der Moodle-Oberfläche („Bento shell fetch“), dazu ein Einstieg für Collegare
MARK='// ---------------- Bento shell fetch'
grep -qF "$MARK" "$CSRC/bentoconvert.js" || { echo "bentoconvert.js: Grenze „Bento shell fetch“ nicht gefunden" >&2; exit 1; }
{
  awk -v m="$MARK" 'index($0, m) == 1 { exit } { print }' "$CSRC/bentoconvert.js"
  echo 'window.collegareBento = { convertPptx: convertPptx, convertPpt: convertPpt };'
} > "$DEST/bentoconvert.js"
cp "$CSRC/LICENSE-JS.md" "$DEST/LICENSE-bentoconvert.md"
fi
printf 'bento %s\nmod_bento %s\n' "$REF" "$CREF" > "$DEST/STAND"
echo "Bento $REF, bentoconvert $CREF -> $DEST"
