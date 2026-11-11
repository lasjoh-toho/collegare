# Collegare

Prozessorientiertes kooperatives Projekt-Framework für gutes wissenschaftliches Arbeiten.
Eigenständige Webapp und externes Werkzeug für Moodle (LTI 1.3), später mit Autogra.fi kombinierbar.

Konzept: [docs/konzept.md](docs/konzept.md)

## Aufbau des Repositorys

| Ordner | Inhalt |
|---|---|
| `client/` | Projektoberfläche (Kanban, Mindmap, Notizen, Einstellungen), Gestaltung nach brausa; bindet die Editoren per iframe ein |
| `web/` | Office-Teil, Grundlage [office-website](https://github.com/lasjoh-toho/office-website) (Fork von ZIZIYI Office, AGPL-3.0) mit den OnlyOffice-Editoren |
| `server/` | Collegare-Server (Node.js, TypeScript): Kollaboration, später LTI, API, Worker |
| `scripts/` | Hilfsskripte, z. B. OnlyOffice-Dateien holen |
| `docs/` | Konzept, Ergebnisse der Meilensteine |

## Installieren

Auf einer VM mit systemd, Apache und MariaDB genügt ein Befehl im Terminal (lädt die neueste Version mit Node.js und
den Office-Editoren):

```bash
curl -fsSL https://raw.githubusercontent.com/lasjoh-toho/collegare/main/packaging/collegare.sh \
  | sudo bash -s -- installieren --url https://server.schule.de/collegare --admin <kürzel>
```

Später aktualisieren: `sudo collegare aktualisieren`. Anleitung mit allen Schritten, Installation von Hand und
Betrieb: [docs/installation.md](docs/installation.md); Moodle-Anbindung: [docs/moodle.md](docs/moodle.md).

## Entwickeln

```bash
scripts/onlyoffice-assets.sh 9.3.1 1          # einmalig, braucht Docker (nur zum Holen der Dateien)
cd server && pnpm install && CORS_ORIGIN=http://localhost:3000,http://localhost:3001 pnpm dev   # :8787
COLLEGARE_PASSWORD=… pnpm cli admin:create admin "Administration"   # erstes Konto (in server/)
cd client && cp .env.example .env.local && pnpm install && pnpm dev    # Projektoberfläche :3001
cd web && cp .env.example .env.local && pnpm install && pnpm dev       # Office-Editoren :3000
```

Im Betrieb liefert der Server die gebauten Oberflächen selbst aus (`client/out` unter `/`, `web/out` unter `/office/`).

Gestaltungsrichtlinie für Autogra.fi und Collegare: [docs/gestaltung.md](docs/gestaltung.md).

### Abweichungen von den Vorlagen

| Stelle | Vorlage | Abweichung und Grund |
|---|---|---|
| Kanban der Gruppenbildung | brausa `CardKanban.svelte` | ohne Suche, Bahnen und Spaltenansichten (Karte = Person, wenige Karten); Säulen stehen am Handy untereinander, damit Lernende ohne seitliches Wischen wählen können; „Hierher wechseln“-Pfeil im Säulenkopf als Alternative zum Ziehen |
| Einstellungsseite | Autogra.fi `einstellungen.html` | gleicher Aufbau (Voreinstellungen mit Leuchten, Akkordeons, ein Speichern, Export/Import), Farben aus brausa; Speichern-Leiste unten fest, damit sie bei langen Seiten erreichbar bleibt |
| Mindmap (Phase Orientierung) | brausa `ProjectMap.svelte` | gleiche Fläche, Karten, Griffe (Pfeilpunkt, Größenecke), Auswahlleiste und Tastatur; Cluster nur eine Ebene tief und unverkleinert statt beliebig tiefer, gezoomter Unterkarten, weil Lernende in der Orientierung nur gruppieren und daraus eine Gliederung machen; ohne Stapel, Dateien und Präsentationspfade; „Bearbeiten“ in der Auswahlleiste, weil Doppeltippen am Handy unzuverlässig ist |
| Startseite `/` und `/zugang` | Autogra.fi `anmelden.html` (welcome.php) | gleicher Aufbau: Kopfbereich im Markenverlauf, Code-Karte oben, „Lehrkräfte – Zum Login“, Erklärkarten; Verlauf rot-orange statt blau (gestaltung.md 2). `/zugang` ist dieselbe Seite ohne Login (Ziel des QR-Codes). Ohne Liste der Lernplattformen, weil Collegare aus Moodle nur per LTI startet |
| Projekt-Portal `/` (angemeldet) und Verwaltung | Autogra.fi `/portal` (Seitenleiste, „Bestehende Aufgaben“ als Karten/Tabelle, „Lehrende“) | gleicher Aufbau, damit sich Lehrkräfte in beiden Apps zurechtfinden; Seitenleiste mit Administration, Meine Projekte und Klassen. Statt Aufgaben stehen Projekte mit Phase, Gruppenstand und fertigen Abschnitten in der Tabelle, dazu ein Hinweis „Neu seit dem letzten Besuch“ (Konzept 8b). Hell als Tagmodus (gestaltung.md 2); Abmelden als Symbol neben Tag/Nacht, weil die Leiste schmal ist. „Lehrende“ ohne Löschen und Aufgabenzahl, das fehlt noch im Server |
| Korrektur `/projekt/korrektur/` | Autogra.fi `korrektur` (Warteschlange links, Kopf mit Vorheriger/Nächster, „Note & Bewertung“ mit Notenblase, „Rückmeldung an Lernende/n“) | gleicher Aufbau. Statt Seiten zeigt die Liste die Produkte (Mindmap, Gliederung, eigene Abschnitte) mit den Zuständen aus gestaltung.md 2; „Gruppen“ ordnet nach Gruppen, Noten bleiben je Person. Vorerst eine Note in Notenpunkten statt Kriterientabelle und ein einfaches Textfeld statt des WYSIWYG-Editors; Freigabe an Lernende und AGS folgen (M4) |
| Mindmap, Ansicht „Äste“ | brausa `ProjectMap.svelte` (Karten-Fläche) | Wunsch Jo (11. November 2026): zusätzlich eine klassische Mindmap mit Thema in der Mitte, gleichmäßig dicken Ästen im U-Bahn-Stil mit Pfeilspitze (je Ast: 45°, rechtwinklig, Kurve oder gerade, Knick, ziehbarer Ansatz an jeder Stelle der Form, Zwischenstopps), eckigen Flächen als Standard und weiteren Formen (Oval, Raute, Parallelogramm), frei ziehbaren Knoten, angelehnt an die Idee von Coggle, nicht an dessen Aussehen. Gleiche Daten wie die Karten-Fläche (Hauptast = Cluster = Abschnitt), Umschalter Äste/Karten je Gerät |
| Seitenmenü der Projektseiten | Autogra.fi `/lernen`, Info und Schrittleiste | Name und Klasse oben links öffnen es (gestaltung.md 6); statt der Schrittleiste oben stehen die Phasen nur im Menü, weil Collegare-Oberflächen wie Mindmap und Editor die volle Höhe brauchen. Auf breiten Bildschirmen anheftbar. Auch Lehrkräfte bekommen es, ihre Knöpfe bleiben rechts in der Kopfzeile |
| Projekt-Übersicht | brausa Projektkacheln | Kacheln je Oberfläche mit den Zuständen aus gestaltung.md 2; oben „Jetzt dran“ mit der Anleitung der aktuellen Phase (wie die Info-Karte in Autogra.fi). Das Board der Gruppenbildung liegt jetzt unter `/projekt/gruppen/` |
| Ausarbeitung | gestaltung.md 5 | keine Leiste mehr über dem Editor: Titel, Zustand und „Fertig melden“ stehen in der Kopfzeile, darüber nur der 6-px-Streifen in Textblau. Der zarte Verlauf hinter dem OnlyOffice-Menüband fehlt noch (bräuchte eine Änderung in `web/`) |
| Akzentfarbe | brausa Blau `#2f6bff` | neutrales Schieferblau `--ui-accent`, weil gestaltung.md 8 eine neutrale, nicht markenhafte Akzentfarbe verlangt und das kräftige Blau mit Textblau `#2b579a` verwechselt würde |

Gemeinsam bearbeiten: `http://localhost:3000/editor?new=docx&collab=test1&name=Anna` und in einem zweiten
Browser `…&name=Ben`. Ergebnisse des ersten Tests: [docs/m0-spike.md](docs/m0-spike.md).

## Lizenz

Kern (`server/`, `client/`) nicht-kommerziell, siehe `LICENSE`; Office-Teil `web/` AGPL-3.0 (`web/LICENSE.txt`). Schulen dürfen Collegare ohne Genehmigung auf eigenen Servern installieren; auf Servern von Unternehmen, die ein Schulträger beauftragt hat, nur mit Genehmigung. Einzelheiten in `LIZENZEN.md`.
