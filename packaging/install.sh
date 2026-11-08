#!/usr/bin/env bash
# Installiert oder aktualisiert Collegare auf einer Linux-VM (Debian/Ubuntu, systemd, Apache, MariaDB).
# Aus dem entpackten Release-Paket als root aufrufen:
#   sudo ./install.sh [--url https://server.schule.de/collegare] [--db mysql://user:pw@127.0.0.1:3306/collegare] [--port 8787] [--admin kürzel]
# Ein zweiter Aufruf mit einem neueren Paket aktualisiert; vorhandene Einstellungen bleiben erhalten.
set -euo pipefail

URL="" DB="" PORT="8787" ADMIN="" NO_APACHE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2%/}"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --no-apache) NO_APACHE=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Bitte als root ausführen (z. B. mit sudo)." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd wird benötigt." >&2; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$SRC/VERSION")"
PREFIX=/opt/collegare
ETC=/etc/collegare
ENVF="$ETC/collegare.env"
DATA=/var/lib/collegare

echo "== Collegare $VERSION"

# Dienstkonto
id collegare >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin collegare
mkdir -p "$PREFIX/releases" "$ETC" "$DATA"
chown collegare:collegare "$DATA"

# Einstellungen beim ersten Mal anlegen
if [ ! -f "$ENVF" ]; then
  if [ -z "$URL" ]; then
    # Adresse vorschlagen: voller Rechnername, sonst die erste IP-Adresse des Servers
    H="$(hostname -f 2>/dev/null || hostname)"
    case "$H" in *.*) ;; *) H="$(hostname -I 2>/dev/null | awk '{print $1}')"; H="${H:-localhost}" ;; esac
    URL="https://$H/collegare"
    if { : </dev/tty; } 2>/dev/null; then
      read -r -p "Adresse, unter der Collegare erreichbar sein soll [$URL]: " ANS </dev/tty
      [ -z "$ANS" ] || URL="${ANS%/}"
    fi
    echo "Adresse: $URL (später änderbar in $ENVF, dann systemctl restart collegare)"
  fi
  if [ -z "$DB" ]; then
    command -v mysql >/dev/null || { echo "MariaDB nicht gefunden. Bitte installieren (apt install mariadb-server) oder --db angeben." >&2; exit 1; }
    PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
    mysql -uroot <<SQL
CREATE DATABASE IF NOT EXISTS collegare CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'collegare'@'localhost' IDENTIFIED BY '$PW';
ALTER USER 'collegare'@'localhost' IDENTIFIED BY '$PW';
GRANT ALL PRIVILEGES ON collegare.* TO 'collegare'@'localhost';
FLUSH PRIVILEGES;
SQL
    DB="mysql://collegare:$PW@127.0.0.1:3306/collegare"
    echo "Datenbank collegare und Nutzer collegare angelegt."
  fi
  umask 077
  cat > "$ENVF" <<ENV
# Collegare – Einstellungen (nur für root und den Dienst lesbar)
PORT=$PORT
HOST=127.0.0.1
APP_URL=$URL
DATABASE_URL=$DB
CLIENT_DIR=$PREFIX/current/client
OFFICE_DIR=$PREFIX/current/office
ENV
  chown root:collegare "$ENVF" && chmod 640 "$ENVF"
  umask 022
fi
# shellcheck disable=SC1090
. "$ENVF"
PORT="${PORT:-8787}"
APP_PATH="$(echo "$APP_URL" | sed -E 's#^https?://[^/]+##')"
APP_PATH="${APP_PATH:-/}"

# Dateien
DEST="$PREFIX/releases/$VERSION"
rm -rf "$DEST" && mkdir -p "$DEST"
cp -a "$SRC/server" "$SRC/client" "$SRC/office" "$SRC/node" "$SRC/VERSION" "$DEST/"
[ -f "$SRC/LICENSE" ] && cp "$SRC/LICENSE" "$SRC/LIZENZEN.md" "$DEST/" || true
ln -sfn "$DEST" "$PREFIX/current"
chown -R root:root "$DEST"

# systemd
cat > /etc/systemd/system/collegare.service <<UNIT
[Unit]
Description=Collegare
After=network.target mariadb.service mysql.service

[Service]
Type=simple
User=collegare
Group=collegare
EnvironmentFile=$ENVF
WorkingDirectory=$PREFIX/current/server
ExecStart=$PREFIX/current/node/bin/node $PREFIX/current/server/dist/main.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable collegare >/dev/null
systemctl restart collegare

# Apache: Unterordner mit WebSocket, Autogra.fi und andere Seiten bleiben unberührt
if [ "$NO_APACHE" = 0 ] && command -v a2enconf >/dev/null; then
  P="${APP_PATH%/}"
  cat > /etc/apache2/conf-available/collegare.conf <<APACHE
# Collegare unter $P (von install.sh erzeugt)
<IfModule mod_proxy.c>
  ProxyPreserveHost On
  RequestHeader set X-Forwarded-Proto "https" env=HTTPS
  ProxyPass        $P/socket.io/ http://127.0.0.1:$PORT/socket.io/ upgrade=websocket
  ProxyPassReverse $P/socket.io/ http://127.0.0.1:$PORT/socket.io/
  ProxyPass        $P/ http://127.0.0.1:$PORT/
  ProxyPassReverse $P/ http://127.0.0.1:$PORT/
  RedirectMatch    ^$P\$ $P/
</IfModule>
APACHE
  a2enmod -q proxy proxy_http proxy_wstunnel headers >/dev/null
  a2enconf -q collegare >/dev/null
  if apachectl configtest 2>/dev/null; then systemctl reload apache2; echo "Apache: $P eingerichtet."; else echo "Apache-Konfiguration fehlerhaft, bitte /etc/apache2/conf-available/collegare.conf prüfen." >&2; fi
else
  echo "Apache nicht eingerichtet. Reverse-Proxy auf http://127.0.0.1:$PORT/ (mit WebSocket für socket.io) selbst anlegen."
fi

# Warten, bis der Dienst antwortet
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[ "${OK:-0}" = 1 ] || { echo "Collegare startet nicht. Protokoll: journalctl -u collegare -n 50" >&2; exit 1; }

# erstes Admin-Konto
run_cli() { (cd "$PREFIX/current/server" && set -a && . "$ENVF" && set +a && runuser -u collegare -- "$PREFIX/current/node/bin/node" dist/cli.js "$@"); }
if [ -n "$ADMIN" ]; then
  if { : </dev/tty; } 2>/dev/null; then read -r -p "Name für $ADMIN: " NAME </dev/tty; else read -r -p "Name für $ADMIN: " NAME; fi
  run_cli admin:create "$ADMIN" "$NAME"
fi

# Befehl `collegare` zum Aktualisieren und Betreiben im Terminal
[ -f "$SRC/collegare.sh" ] && install -m 755 "$SRC/collegare.sh" /usr/local/sbin/collegare

# alte Versionen aufräumen (die letzten drei bleiben)
ls -1dt "$PREFIX"/releases/* | tail -n +4 | xargs -r rm -rf

echo
echo "Collegare $VERSION läuft: $APP_URL"
echo "Moodle eintragen: $APP_URL/verwaltung/moodle/ (als Administration anmelden)"
[ -n "$ADMIN" ] || echo "Erstes Konto anlegen: sudo collegare admin <kürzel>"
echo "Später aktualisieren: sudo collegare aktualisieren"
