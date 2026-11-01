# Collegare – Hinweise für die Arbeit an diesem Repository

Collegare ist ein prozessorientiertes Werkzeug für kooperative Projektarbeit in der Oberstufe: eigenständige Webapp
und LTI-1.3-Werkzeug für Moodle, später mit Autogra.fi kombinierbar. Maßgeblich ist `docs/konzept.md`,
besonders Abschnitt 10 (Entscheidungen). Ergebnisse des ersten Tests: `docs/m0-spike.md`.

## Sprache und Stil

- Oberfläche, Doku, Commit-Nachrichten und Code-Kommentare auf Deutsch; Bezeichner im Code auf Englisch.
- Oberfläche folgt office-website (`web/`); Kanban, Mindmap und Notiz-Thread folgen der Gestaltung von
  [brausa](https://github.com/lasjoh-toho/brausa) (`src/lib/components/ProjectMap.svelte`, `CardKanban.svelte`,
  `NotesThread.svelte`, Farben in `src/app.css`), in React nachgebaut. Teile aus Autogra.fi (Scanner, QR-Kopplung)
  behalten ihre Bedienung. Abweichungen im README begründen.

## Festgelegte Entscheidungen (nicht ohne Rücksprache ändern)

- Backend Node.js 22 + TypeScript (`server/`), Fastify, socket.io; Frontend Next.js (`web/`, statischer Export).
- Betrieb ohne Docker direkt auf einer VM (systemd, Reverse-Proxy, Unterordner `/collegare`), MariaDB.
- Moodle-Grundlage nur LTI 1.3 mit AGS und NRPS (Moodle ab 3.7); kein Moodle-Plugin voraussetzen.
- Gruppen entstehen im Kanban von Collegare. „Fertig“-Sperre je Karte/Abschnitt einer Person und je Folie,
  nicht je Absatz.
- Tippfluss-Analyse nur mit Freischaltung durch Administration und Lehrkraft; nur Hinweise, nie Bewertung.
- Lizenz AGPL-3.0.

## Arbeiten

```bash
scripts/onlyoffice-assets.sh 9.3.1 1      # OnlyOffice-Dateien (Docker nur zum Holen)
cd server && pnpm install && pnpm test     # Protokolltests müssen grün sein
cd web && pnpm install && npx tsc --noEmit
```

- Vor jedem Push: `pnpm test` in `server/` und `npx tsc --noEmit` in `web/`.
- Mehrere Personen arbeiten mit: größere Arbeiten auf einem eigenen Branch mit Pull Request, nicht direkt auf `main`.
  Aufgaben und Zuständigkeiten stehen in den GitHub-Issues.
- Keine Zugangsdaten, Tokens oder Schülerdaten ins Repository.
