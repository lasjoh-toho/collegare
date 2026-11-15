#!/usr/bin/env bash
# Collegare im Terminal installieren, aktualisieren und betreiben.
#
# Erstinstallation (lädt die neueste Version von GitHub, prüft die Prüfsumme, ruft install.sh auf):
#   curl -fsSL https://raw.githubusercontent.com/lasjoh-toho/collegare/main/packaging/collegare.sh \
#     | sudo bash -s -- installieren --url https://server.schule.de/collegare --admin jo
# Danach liegt dieser Befehl als `collegare` auf dem Server:
#   sudo collegare aktualisieren            neueste Version (auch Vorabversionen)
#   sudo collegare aktualisieren 0.3.0      bestimmte Version
#   collegare version                       installierte und neueste Version
#   sudo collegare zurueck 0.2.0            auf eine vorhandene ältere Version zurück
#   sudo collegare adresse https://…/collegare   Adresse ändern (Apache wird mit angepasst)
#   collegare status | protokoll            Dienst ansehen
#   sudo collegare neustart
#   sudo collegare admin <kürzel>           weiteres Administrationskonto
#   sudo collegare passwort <kürzel>        Passwort neu setzen
#   sudo collegare pruefen                  Protokollkette und Pinnwand-Medien prüfen
#   sudo collegare sichern [ordner]         Datenbank und Dateien (Pinnwand-Medien) zusammen sichern
#                                           (Standard /var/backups/collegare, die letzten 14 bleiben)
#   sudo collegare zurueckholen <datei>     eine solche Sicherung zurückspielen (ersetzt alles!)
set -euo pipefail

REPO=lasjoh-toho/collegare
PREFIX=/opt/collegare
ENVF=/etc/collegare/collegare.env

die() { echo "$*" >&2; exit 1; }
has_tty() { { : </dev/tty; } 2>/dev/null; }
need_root() { [ "$(id -u)" = 0 ] || die "Bitte als root aufrufen (z. B. mit sudo)."; }
installed() { cat "$PREFIX/current/VERSION" 2>/dev/null || echo "keine"; }

# neueste Version laut GitHub (Vorabversionen eingeschlossen, die neueste zuerst)
latest() {
  local json
  json="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1")" || return 1
  printf '%s\n' "$json" | grep '"tag_name"' | head -n1 | sed -E 's/.*"v?([^"]+)".*/\1/'
}

# Paket holen, prüfen, entpacken und install.sh mit den übrigen Angaben aufrufen
fetch_and_install() {
  local v="$1"; shift
  [ -n "$v" ] || v="$(latest)"
  [ -n "$v" ] || die "Keine Version auf GitHub gefunden."
  local pkg="collegare-$v-linux-x64.tar.gz" base="https://github.com/$REPO/releases/download/v$v"
  TMPD="$(mktemp -d /var/tmp/collegare.XXXXXX)"
  trap 'rm -rf "$TMPD"' EXIT
  local tmp="$TMPD"
  echo "== Lade Collegare $v (etwa 700 MB) …"
  curl -fL --progress-bar "$base/$pkg" -o "$tmp/$pkg" || die "Download fehlgeschlagen: $base/$pkg"
  curl -fsSL "$base/$pkg.sha256" -o "$tmp/$pkg.sha256"
  (cd "$tmp" && sha256sum -c --quiet "$pkg.sha256") || die "Prüfsumme stimmt nicht, Abbruch."
  tar -xzf "$tmp/$pkg" -C "$tmp"
  rm "$tmp/$pkg"
  # Rückfragen (Name, Passwort) kommen vom Terminal, auch wenn dieses Skript über curl | bash läuft
  if has_tty; then "$tmp/collegare-$v/install.sh" "$@" </dev/tty; else "$tmp/collegare-$v/install.sh" "$@"; fi
}

# Einstellungen lesen (DATABASE_URL, DATA_DIR)
load_env() {
  set -a; . "$ENVF"; set +a
  DATA_DIR="${DATA_DIR:-/var/lib/collegare}"
}

# mysql://nutzer:passwort@host:port/datenbank zerlegen; das Passwort geht über eine Datei, nicht über die Befehlszeile
db_args() {
  local u="${DATABASE_URL#mysql://}" cred hostpart
  case "$DATABASE_URL" in mysql://*) ;; *) die "Sichern geht nur mit MariaDB/MySQL (DATABASE_URL=mysql://…)." ;; esac
  cred="${u%%@*}"; hostpart="${u#*@}"
  DB_USER="${cred%%:*}"; DB_PASS="${cred#*:}"
  DB_NAME="${hostpart#*/}"; DB_NAME="${DB_NAME%%\?*}"
  hostpart="${hostpart%%/*}"; DB_HOST="${hostpart%%:*}"; DB_PORT="${hostpart#*:}"; [ "$DB_PORT" != "$hostpart" ] || DB_PORT=3306
  DB_CNF="$(mktemp)"; chmod 600 "$DB_CNF"
  printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "$DB_USER" "$(printf '%b' "${DB_PASS//%/\\x}")" "$DB_HOST" "$DB_PORT" > "$DB_CNF"
}
db_dump() { db_args; mysqldump --defaults-extra-file="$DB_CNF" --single-transaction --routines "$DB_NAME"; local rc=$?; rm -f "$DB_CNF"; return $rc; }
db_restore() { db_args; mysql --defaults-extra-file="$DB_CNF" "$DB_NAME"; local rc=$?; rm -f "$DB_CNF"; return $rc; }

run_cli() {
  need_root
  [ -f "$ENVF" ] || die "Collegare ist nicht installiert."
  (cd "$PREFIX/current/server" && set -a && . "$ENVF" && set +a && runuser -u collegare -- "$PREFIX/current/node/bin/node" dist/cli.js "$@")
}

cmd="${1:-hilfe}"; shift || true
case "$cmd" in
  installieren|install)
    need_root
    [ ! -f "$ENVF" ] || echo "Collegare ist schon eingerichtet; es wird aktualisiert."
    v=""; if [ $# -gt 0 ] && [[ "$1" != --* ]]; then v="$1"; shift; fi
    fetch_and_install "$v" "$@" ;;
  aktualisieren|update)
    need_root
    [ -f "$ENVF" ] || die "Noch nicht installiert. Erst: collegare installieren --url https://…/collegare --admin <kürzel>"
    v="${1:-$(latest)}"
    [ "$v" != "$(installed)" ] || { echo "Collegare $v ist schon installiert."; exit 0; }
    fetch_and_install "$v" ;;
  version)
    echo "installiert: $(installed)"
    echo "neueste:     $(latest || echo unbekannt)" ;;
  zurueck|rollback)
    need_root
    [ -n "${1:-}" ] || { echo "Vorhanden:"; ls -1 "$PREFIX/releases"; exit 0; }
    [ -d "$PREFIX/releases/$1" ] || die "Version $1 liegt nicht unter $PREFIX/releases."
    ln -sfn "$PREFIX/releases/$1" "$PREFIX/current" && systemctl restart collegare && echo "Zurück auf $1." ;;
  adresse)
    need_root
    [ -n "${1:-}" ] || { grep '^APP_URL=' "$ENVF"; exit 0; }
    [ -x "$PREFIX/current/install.sh" ] || die "Diese Version hat den Installer nicht abgelegt. Bitte: collegare aktualisieren"
    "$PREFIX/current/install.sh" --url "${1%/}" ;;
  status) systemctl status collegare --no-pager ;;
  protokoll|log) journalctl -u collegare -f ;;
  neustart|restart) need_root; systemctl restart collegare ;;
  admin) [ -n "${1:-}" ] || die "Kürzel angeben."; if has_tty; then read -r -p "Name für $1: " NAME </dev/tty; else read -r -p "Name für $1: " NAME; fi; run_cli admin:create "$1" "$NAME" ;;
  pruefen)
    rc=0
    run_cli audit:verify || rc=$?
    run_cli pinnwand:pruefen || rc=$?
    exit "$rc" ;;
  sichern|backup)
    need_root
    [ -f "$ENVF" ] || die "Collegare ist nicht installiert."
    load_env
    dest="${1:-/var/backups/collegare}"
    mkdir -p "$dest" && chmod 700 "$dest"
    stamp="$(date +%Y-%m-%d-%H%M%S)"
    work="$(mktemp -d /var/tmp/collegare-sichern.XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    echo "== Datenbank …"
    db_dump > "$work/datenbank.sql"
    echo "== Dateien aus $DATA_DIR …"
    base="$(basename "$DATA_DIR")"
    tar -czf "$dest/collegare-$stamp.tar.gz" --exclude='*.tmp' --transform "s#^$base#dateien#" \
      -C "$work" datenbank.sql -C "$(dirname "$DATA_DIR")" "$base"
    chmod 600 "$dest/collegare-$stamp.tar.gz"
    ls -1t "$dest"/collegare-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
    echo "Gesichert: $dest/collegare-$stamp.tar.gz ($(du -h "$dest/collegare-$stamp.tar.gz" | cut -f1))" ;;
  zurueckholen|restore)
    need_root
    f="${1:-}"; [ -f "$f" ] || die "Sicherungsdatei angeben, z. B. /var/backups/collegare/collegare-….tar.gz"
    load_env
    if has_tty; then
      read -r -p "Alles in Collegare wird durch den Stand aus $f ersetzt. Weiter? (ja/nein) " ANS </dev/tty
      [ "$ANS" = ja ] || die "Abgebrochen."
    fi
    work="$(mktemp -d /var/tmp/collegare-zurueck.XXXXXX)"
    trap 'rm -rf "$work"' EXIT
    tar -xzf "$f" -C "$work"
    [ -f "$work/datenbank.sql" ] || die "In der Datei fehlt datenbank.sql."
    systemctl stop collegare
    db_restore < "$work/datenbank.sql"
    if [ -d "$work/dateien" ]; then
      rm -rf "$DATA_DIR/pinnwand"
      cp -a "$work/dateien/." "$DATA_DIR/"
      chown -R collegare:collegare "$DATA_DIR"
    fi
    systemctl start collegare
    echo "Zurückgeholt: $f" ;;
  passwort) [ -n "${1:-}" ] || die "Kürzel angeben."; run_cli admin:password "$1" ;;
  hilfe|-h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Unbekannter Befehl: $cmd (collegare hilfe)" ;;
esac
