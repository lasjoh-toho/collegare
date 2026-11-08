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
#   collegare status | protokoll            Dienst ansehen
#   sudo collegare neustart
#   sudo collegare admin <kürzel>           weiteres Administrationskonto
#   sudo collegare passwort <kürzel>        Passwort neu setzen
#   sudo collegare pruefen                  Protokollkette prüfen
set -euo pipefail

REPO=lasjoh-toho/collegare
PREFIX=/opt/collegare
ENVF=/etc/collegare/collegare.env

die() { echo "$*" >&2; exit 1; }
has_tty() { { : </dev/tty; } 2>/dev/null; }
need_root() { [ "$(id -u)" = 0 ] || die "Bitte mit sudo aufrufen."; }
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

run_cli() {
  need_root
  [ -f "$ENVF" ] || die "Collegare ist nicht installiert."
  (cd "$PREFIX/current/server" && set -a && . "$ENVF" && set +a && sudo -E -u collegare "$PREFIX/current/node/bin/node" dist/cli.js "$@")
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
  status) systemctl status collegare --no-pager ;;
  protokoll|log) journalctl -u collegare -f ;;
  neustart|restart) need_root; systemctl restart collegare ;;
  admin) [ -n "${1:-}" ] || die "Kürzel angeben."; if has_tty; then read -r -p "Name für $1: " NAME </dev/tty; else read -r -p "Name für $1: " NAME; fi; run_cli admin:create "$1" "$NAME" ;;
  pruefen) run_cli audit:verify ;;
  passwort) [ -n "${1:-}" ] || die "Kürzel angeben."; run_cli admin:password "$1" ;;
  hilfe|-h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Unbekannter Befehl: $cmd (collegare hilfe)" ;;
esac
