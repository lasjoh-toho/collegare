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

## Entwickeln

```bash
scripts/onlyoffice-assets.sh 9.3.1 1          # einmalig, braucht Docker (nur zum Holen der Dateien)
cd server && pnpm install && CORS_ORIGIN=http://localhost:3000,http://localhost:3001 pnpm dev   # :8787
COLLEGARE_PASSWORD=… pnpm cli admin:create admin "Administration"   # erstes Konto (in server/)
cd client && cp .env.example .env.local && pnpm install && pnpm dev    # Projektoberfläche :3001
cd web && cp .env.example .env.local && pnpm install && pnpm dev       # Office-Editoren :3000
```

Im Betrieb liefert der Server die gebauten Oberflächen selbst aus (`client/out` unter `/`, `web/out` unter `/office/`).

### Abweichungen von den Vorlagen

| Stelle | Vorlage | Abweichung und Grund |
|---|---|---|
| Kanban der Gruppenbildung | brausa `CardKanban.svelte` | ohne Suche, Bahnen und Spaltenansichten (Karte = Person, wenige Karten); Säulen stehen am Handy untereinander, damit Lernende ohne seitliches Wischen wählen können; „Hierher wechseln“-Pfeil im Säulenkopf als Alternative zum Ziehen |
| Einstellungsseite | Autogra.fi `einstellungen.html` | gleicher Aufbau (Voreinstellungen mit Leuchten, Akkordeons, ein Speichern, Export/Import), Farben aus brausa; Speichern-Leiste unten fest, damit sie bei langen Seiten erreichbar bleibt |
| Code-Eingabe `/zugang` | Autogra.fi `zugang.html` | gleiche Bedienung (großes Codefeld, QR-Hinweis), aber Farben aus brausa, damit Collegare einheitlich aussieht |

Gemeinsam bearbeiten: `http://localhost:3000/editor?new=docx&collab=test1&name=Anna` und in einem zweiten
Browser `…&name=Ben`. Ergebnisse des ersten Tests: [docs/m0-spike.md](docs/m0-spike.md).

## Lizenz

Kern (`server/`, `client/`) nicht-kommerziell, siehe `LICENSE`; Office-Teil `web/` AGPL-3.0 (`web/LICENSE.txt`). Einzelheiten in `LIZENZEN.md`.
