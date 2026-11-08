# Collegare installieren (VM ohne Docker)

Das Release-Paket enthält alles, was Collegare zum Laufen braucht: Server, Projektoberfläche, Office-Editoren und
Node.js 22. Auf der VM müssen nur systemd, Apache und MariaDB vorhanden sein. Collegare läuft im Unterordner
`/collegare`; andere Seiten auf demselben Apache (z. B. Autogra.fi) bleiben unberührt.

## Voraussetzungen

- Debian oder Ubuntu (x86-64) mit systemd
- Apache 2.4 mit HTTPS (Zertifikat ist schon eingerichtet)
- MariaDB ab 10.6 (`apt install mariadb-server`), root kann sich lokal ohne Passwort anmelden (Standard bei Debian/Ubuntu)
- etwa 2 GB freier Platz (das Paket hält die letzten drei Versionen vor)

## Erstinstallation im Terminal (empfohlen)

Ein Befehl lädt die neueste Version von GitHub, prüft die Prüfsumme, entpackt sie und richtet alles ein:

```bash
curl -fsSL https://raw.githubusercontent.com/lasjoh-toho/collegare/main/packaging/collegare.sh \
  | sudo bash -s -- installieren --url https://server.schule.de/collegare --admin jo
```

- `--url` ist die Adresse, unter der Collegare später erreichbar sein soll (Unterordner `/collegare`).
- `--admin jo` legt das erste Administrationskonto an; der Installer fragt im Terminal nach Name und Passwort.
- Eine bestimmte Version statt der neuesten: `… installieren 0.3.0 --url … --admin jo`.

Danach gibt es auf dem Server den Befehl `collegare` (siehe „Aktualisieren“ und „Betrieb“).

## Erstinstallation von Hand

Wer das Paket lieber selbst lädt (z. B. ohne Internet auf dem Server), nimmt es von der
[Release-Seite](https://github.com/lasjoh-toho/collegare/releases):

```bash
V=0.3.0
wget https://github.com/lasjoh-toho/collegare/releases/download/v$V/collegare-$V-linux-x64.tar.gz
wget https://github.com/lasjoh-toho/collegare/releases/download/v$V/collegare-$V-linux-x64.tar.gz.sha256
sha256sum -c collegare-$V-linux-x64.tar.gz.sha256
tar -xzf collegare-$V-linux-x64.tar.gz
cd collegare-$V
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

```bash
collegare version                 # installierte und neueste Version
sudo collegare aktualisieren      # auf die neueste Version
sudo collegare aktualisieren 0.3.0   # auf eine bestimmte Version
```

Einstellungen und Datenbank bleiben erhalten; die Datenbank wird beim Start automatisch auf den neuen Stand gebracht.
Ohne den Befehl `collegare` (Installation vor 0.3.1): den Einzeiler aus der Erstinstallation mit `aktualisieren` statt
`installieren` und ohne weitere Angaben aufrufen, oder ein neues Paket von Hand entpacken und `sudo ./install.sh`
aufrufen.

Zurück auf eine vorige Version (die letzten drei bleiben auf dem Server):

```bash
sudo collegare zurueck            # zeigt die vorhandenen Versionen
sudo collegare zurueck 0.2.0
```

(Nur, wenn die neuere Version die Datenbank nicht verändert hat; die Release-Notizen sagen das.)

## Betrieb

| Aufgabe | Befehl |
|---|---|
| Zustand | `collegare status` |
| Protokoll | `collegare protokoll` |
| Neu starten | `sudo collegare neustart` |
| Weiteres Admin-Konto | `sudo collegare admin <kürzel>` |
| Passwort zurücksetzen | `sudo collegare passwort <kürzel>` |
| Protokollkette prüfen | `sudo collegare pruefen` |
| Alle Befehle | `collegare hilfe` |
| Sicherung | `mysqldump collegare > collegare.sql` (enthält Schülerdaten, sicher ablegen) |

## Selbst bauen

```bash
scripts/onlyoffice-assets.sh 9.3.1 1   # einmalig, Docker nur zum Holen der OnlyOffice-Dateien
scripts/build-release.sh 0.3.1         # → dist-release/collegare-0.3.1-linux-x64.tar.gz
```

Auf GitHub baut der Workflow „Release“ das Paket und hängt es an ein Release (Actions → Release → Run workflow).
