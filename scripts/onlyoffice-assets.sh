#!/usr/bin/env bash
# Holt die OnlyOffice-Editor-Dateien (sdkjs, web-apps, Schriften, Plugins) aus dem
# offiziellen documentserver-Image nach web/public/v<VERSION>-<HASH>.
# Braucht Docker nur beim Bauen (z. B. im GitHub-Workflow), nicht auf dem Schulserver.
set -euo pipefail
VERSION="${1:-9.3.1}"
HASH="${2:-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/web/public/v${VERSION}-${HASH}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/Dockerfile" <<DOCKER
FROM onlyoffice/documentserver:${VERSION}
RUN documentserver-generate-allfonts.sh false
DOCKER
docker build -q -t "collegare-oo-assets:${VERSION}" "$TMP" >/dev/null
CID="$(docker create "collegare-oo-assets:${VERSION}")"
trap 'docker rm -f "$CID" >/dev/null; rm -rf "$TMP"' EXIT
rm -rf "$DEST" && mkdir -p "$DEST"
for d in fonts sdkjs web-apps sdkjs-plugins; do
  docker cp -q "$CID:/var/www/onlyoffice/documentserver/$d" "$DEST/"
done
cp "$DEST/web-apps/apps/api/documents/api.js.tpl" "$DEST/web-apps/apps/api/documents/api.js"
echo "OnlyOffice ${VERSION} in $DEST ($(du -sh "$DEST" | cut -f1))."
echo "Next.js mit NEXT_PUBLIC_APP_ROOT=/v${VERSION}-${HASH} starten bzw. bauen."
