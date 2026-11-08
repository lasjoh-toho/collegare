#!/usr/bin/env bash
# Baut das Release-Paket für die VM (ohne Docker): Server, Projektoberfläche, Office-Editoren, Node 22.
#   scripts/build-release.sh <version> [node-version]
# Voraussetzung: pnpm, Node 22, OnlyOffice-Dateien in web/public/v9.3.1-1 (scripts/onlyoffice-assets.sh 9.3.1 1).
set -euo pipefail
VERSION="${1:?Version angeben, z. B. 0.1.0}"
NODE_VERSION="${2:-22.12.0}"
BASE="${COLLEGARE_BASE_PATH:-/collegare}"
OO_ROOT="${COLLEGARE_OO_ROOT:-v9.3.1-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist-release"
PKG="collegare-$VERSION"
STAGE="$OUT/$PKG"

rm -rf "$STAGE" && mkdir -p "$STAGE"
[ -d "$ROOT/web/public/$OO_ROOT" ] || { echo "OnlyOffice-Dateien fehlen: scripts/onlyoffice-assets.sh 9.3.1 1" >&2; exit 1; }

echo "== Server"
( cd "$ROOT/server" && pnpm install --frozen-lockfile && pnpm test && pnpm build )
mkdir -p "$STAGE/server"
cp -r "$ROOT/server/dist" "$ROOT/server/package.json" "$ROOT/server/pnpm-lock.yaml" "$STAGE/server/"
cp "$ROOT/server/.env.example" "$STAGE/server/env.example"
# nur Laufzeit-Abhängigkeiten, flach, ohne SQLite (natives Modul, im Betrieb MariaDB)
( cd "$STAGE/server" && pnpm install --prod --frozen-lockfile --no-optional --config.node-linker=hoisted --ignore-scripts )

echo "== Projektoberfläche"
( cd "$ROOT/client" && pnpm install --frozen-lockfile && NEXT_PUBLIC_BASE_PATH="$BASE" NEXT_PUBLIC_API_URL= npx next build )
cp -r "$ROOT/client/out" "$STAGE/client"

echo "== Office-Editoren"
( cd "$ROOT/web" && pnpm install --frozen-lockfile && NEXT_PUBLIC_BASE_PATH="$BASE/office" NEXT_PUBLIC_APP_ROOT="$BASE/office/$OO_ROOT" NEXT_PUBLIC_COLLAB_URL= NEXT_PUBLIC_COLLAB_PATH="$BASE/socket.io" npx next build )
cp -r "$ROOT/web/out" "$STAGE/office"

echo "== Node $NODE_VERSION"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$OUT/node.tar.xz"
mkdir -p "$STAGE/node" && tar -xJf "$OUT/node.tar.xz" -C "$STAGE/node" --strip-components=1 && rm "$OUT/node.tar.xz"
rm -rf "$STAGE/node/include" "$STAGE/node/share"

echo "== Installer"
cp "$ROOT/packaging/install.sh" "$STAGE/install.sh" && chmod +x "$STAGE/install.sh"
cp "$ROOT/packaging/collegare.sh" "$STAGE/collegare.sh" && chmod +x "$STAGE/collegare.sh"
cp "$ROOT/LICENSE" "$ROOT/LIZENZEN.md" "$ROOT/docs/installation.md" "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"

( cd "$OUT" && tar -czf "$PKG-linux-x64.tar.gz" "$PKG" && sha256sum "$PKG-linux-x64.tar.gz" > "$PKG-linux-x64.tar.gz.sha256" )
echo "Fertig: $OUT/$PKG-linux-x64.tar.gz"
