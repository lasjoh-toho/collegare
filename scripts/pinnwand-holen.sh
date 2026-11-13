#!/usr/bin/env bash
# Holt die Oberfläche von mod_pinnwand (lasjoh-toho/moodle-mod_pinnwand) in einem festen Stand für das
# Pinnwand-Modul (Konzept 8d.5): js/, styles.css, LICENSE und die deutschen Texte als JSON nach
# client/public/pinnwand/mod/pinnwand/. Gleiche Lizenz wie der Kern (LIZENZEN.md).
#   scripts/pinnwand-holen.sh            Stand aus scripts/pinnwand.ref
#   scripts/pinnwand-holen.sh <commit>   anderer Stand
#   PINNWAND_SRC=/pfad/zum/repo …        aus einem vorhandenen Ordner statt von GitHub
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-$(tr -d '[:space:]' < "$ROOT/scripts/pinnwand.ref")}"
DEST="$ROOT/client/public/pinnwand/mod/pinnwand"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -n "${PINNWAND_SRC:-}" ]]; then
  SRC="$PINNWAND_SRC"
else
  git -C "$TMP" init -q src
  git -C "$TMP/src" fetch -q --depth 1 https://github.com/lasjoh-toho/moodle-mod_pinnwand "$REF"
  git -C "$TMP/src" checkout -q FETCH_HEAD
  SRC="$TMP/src"
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/js" "$DEST/js"
cp "$SRC/styles.css" "$SRC/LICENSE" "$DEST/"
[[ -d "$SRC/pix" ]] && cp -r "$SRC/pix" "$DEST/pix"
node "$ROOT/scripts/pinnwand-texte.mjs" "$SRC/lang/de/pinnwand.php" "$SRC/lang/en/pinnwand.php" > "$DEST/strings.json"
echo "$REF" > "$DEST/STAND"
echo "mod_pinnwand $REF -> $DEST"
