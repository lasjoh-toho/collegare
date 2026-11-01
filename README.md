# Collegare

Prozessorientiertes kooperatives Projekt-Framework für gutes wissenschaftliches Arbeiten.
Eigenständige Webapp und externes Werkzeug für Moodle (LTI 1.3), später mit Autogra.fi kombinierbar.

Konzept: [docs/konzept.md](docs/konzept.md)

## Aufbau des Repositorys

| Ordner | Inhalt |
|---|---|
| `client/` | Projektoberfläche (Kanban, Mindmap, Notizen, Einstellungen), Gestaltung nach brausa; bindet die Editoren per iframe ein (folgt in M1) |
| `web/` | Office-Teil, Grundlage [office-website](https://github.com/lasjoh-toho/office-website) (Fork von ZIZIYI Office, AGPL-3.0) mit den OnlyOffice-Editoren |
| `server/` | Collegare-Server (Node.js, TypeScript): Kollaboration, später LTI, API, Worker |
| `scripts/` | Hilfsskripte, z. B. OnlyOffice-Dateien holen |
| `docs/` | Konzept, Ergebnisse der Meilensteine |

## Entwickeln

```bash
scripts/onlyoffice-assets.sh 9.3.1 1          # einmalig, braucht Docker (nur zum Holen der Dateien)
cd server && pnpm install && CORS_ORIGIN=http://localhost:3000 pnpm dev   # :8787
cd web && cp .env.example .env.local && pnpm install && pnpm dev          # :3000
```

Gemeinsam bearbeiten: `http://localhost:3000/editor?new=docx&collab=test1&name=Anna` und in einem zweiten
Browser `…&name=Ben`. Ergebnisse des ersten Tests: [docs/m0-spike.md](docs/m0-spike.md).

## Lizenz

Kern (`server/`, `client/`) nicht-kommerziell, siehe `LICENSE`; Office-Teil `web/` AGPL-3.0 (`web/LICENSE.txt`). Einzelheiten in `LIZENZEN.md`.
