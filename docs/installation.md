# Collegare installieren (VM ohne Docker)

Das Release-Paket enthält alles, was Collegare zum Laufen braucht: Server, Projektoberfläche, Office-Editoren und
Node.js 22. Auf der VM müssen nur systemd, Apache und MariaDB vorhanden sein. Collegare läuft im Unterordner
`/collegare`; andere Seiten auf demselben Apache (z. B. Autogra.fi) bleiben unberührt.

## Voraussetzungen

- Debian oder Ubuntu (x86-64) mit systemd
- Apache 2.4 mit HTTPS (Zertifikat ist schon eingerichtet)
- MariaDB ab 10.6 (`apt install mariadb-server`), root kann sich lokal ohne Passwort anmelden (Standard bei Debian/Ubuntu)
- etwa 2 GB freier Platz (das Paket hält die letzten drei Versionen vor)

## Erstinstallation

```bash
wget https://github.com/lasjoh-toho/collegare/releases/download/v0.1.0/collegare-0.1.0-linux-x64.tar.gz
sha256sum -c collegare-0.1.0-linux-x64.tar.gz.sha256   # optional, Prüfsumme liegt daneben
tar -xzf collegare-0.1.0-linux-x64.tar.gz
cd collegare-0.1.0
sudo ./install.sh --url https://server.schule.de/collegare --admin jo
```

Der Installer

1. legt das Dienstkonto `collegare` an,
2. legt in MariaDB die Datenbank `collegare` mit eigenem Nutzer und zufälligem Passwort an
   (mit `--db mysql://nutzer:passwort@host:3306/datenbank` stattdessen eine vorhandene nutzen),
3. schreibt die Einstellungen nach `/etc/collegare/collegare.env` (nur für root und den Dienst lesbar),
4. kopiert die Dateien nach `/opt/collegare/releases/<version>` und setzt `/opt/collegare/current`,
5. richtet den systemd-Dienst `collegare` ein und startet ihn (lauscht nur auf `127.0.0.1:8787`),
6. legt `/etc/apache2/conf-available/collegare.conf` an (Reverse-Proxy mit WebSocket) und lädt Apache neu,
7. fragt bei `--admin` nach dem Namen und dem Passwort für das erste Administrationskonto.

Danach unter `https://server.schule.de/collegare/` anmelden.

Weitere Optionen: `--port 8790` (falls 8787 belegt ist), `--no-apache` (Reverse-Proxy selbst einrichten; nötig sind
`ProxyPass` für `/collegare/` und für `/collegare/socket.io/` mit `upgrade=websocket`).

## Moodle verbinden

Siehe [moodle.md](moodle.md). Kurz: in Moodle ein externes Tool (LTI 1.3) anlegen, dann in Collegare unter
**Verwaltung → Moodle-Verbindung** die Moodle-Adresse, Client-ID und Deployment-ID eintragen.

## Aktualisieren

Neues Paket herunterladen, entpacken und `sudo ./install.sh` ohne weitere Angaben aufrufen. Einstellungen und Datenbank
bleiben erhalten; die Datenbank wird beim Start automatisch auf den neuen Stand gebracht.

Zurück auf die vorige Version:

```bash
ls /opt/collegare/releases
sudo ln -sfn /opt/collegare/releases/0.1.0 /opt/collegare/current && sudo systemctl restart collegare
```

(Nur, wenn die neuere Version die Datenbank nicht verändert hat; die Release-Notizen sagen das.)

## Betrieb

| Aufgabe | Befehl |
|---|---|
| Zustand | `systemctl status collegare` |
| Protokoll | `journalctl -u collegare -f` |
| Neu starten | `sudo systemctl restart collegare` |
| Weiteres Admin-Konto | `sudo ./install.sh --admin <kürzel>` (aus einem entpackten Paket) |
| Passwort zurücksetzen | `cd /opt/collegare/current/server && sudo bash -c 'set -a; . /etc/collegare/collegare.env; sudo -E -u collegare ../node/bin/node dist/cli.js admin:password <kürzel>'` |
| Protokollkette prüfen | wie oben mit `audit:verify` |
| Sicherung | `mysqldump collegare > collegare.sql` (enthält Schülerdaten, sicher ablegen) |

## Selbst bauen

```bash
scripts/onlyoffice-assets.sh 9.3.1 1   # einmalig, Docker nur zum Holen der OnlyOffice-Dateien
scripts/build-release.sh 0.1.0         # → dist-release/collegare-0.1.0-linux-x64.tar.gz
```

Auf GitHub baut der Workflow „Release“ das Paket und hängt es an ein Release (Actions → Release → Run workflow).
