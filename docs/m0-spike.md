# M0-Spike: Gemeinsames Bearbeiten mit den OnlyOffice-Editoren

Stand: 1. November 2026 · Ergebnis: **eigener Kollaborationsserver trägt, weiter mit diesem Weg**

## Frage

Kann Collegare den MockSocket aus office-website durch einen eigenen, schlanken Server ersetzen, sodass mehrere Personen
dasselbe Dokument gleichzeitig bearbeiten, und lässt sich die Fertig-Sperre (Konzept 5.3) über das Sperrprotokoll
des Editors durchsetzen? Ausstiegsoption wäre ein vollständiger OnlyOffice Document Server oder ein eigener Texteditor.

## Aufbau

- `server/`: Node.js 22, TypeScript, Fastify, socket.io (Namespace `/collab`). `src/collab/coServer.ts` bildet die
  Nachrichten `auth`, `authChanges`, `getLock`, `releaseLock`, `saveChanges`, `isSaveLock`, `unSaveLock`,
  `unLockDocument`, `cursor`, `message`, `connectState` nach (Referenz: ONLYOFFICE/server `DocsCoServer.js`).
  Zustand je Dokument in `src/collab/docState.ts`, im Spike nur im Speicher.
- `web/`: office-website. Der lokale `EditorServer` lädt das Dokument weiter im Browser (x2t-WASM), leitet aber die
  Protokollnachrichten an den Server weiter, sobald die Seite mit `?collab=<id>&name=<Name>` geöffnet wird
  (`utils/editor/server.ts`, `setCollab`). Einfügen im Editor-iframe wird als Prozess-Ereignis gemeldet.
- OnlyOffice 9.3.1, Dateien per `scripts/onlyoffice-assets.sh` aus dem offiziellen Image.

## Ergebnisse

| Prüfung | Ergebnis |
|---|---|
| Text, schneller Modus: Anna tippt, Ben sieht es live | ✅ |
| Späterer Beitritt (Clara) bekommt alle Änderungen über `authChanges` | ✅ |
| Präsentation: Anna schreibt in den Folientitel, Ben sieht Folie und Miniatur aktualisiert | ✅ |
| Strenger Modus: Absatz, den Anna bearbeitet, ist für Ben gesperrt (Editor zeigt Sperrmarke, Werkzeugleiste grau) | ✅ |
| **Fertig-Sperre im schnellen Modus:** Server meldet für Annas Absatz (ID bekannt) eine dauerhafte Sperre; Ben kann dort nicht mehr tippen, es kommen keine Änderungen von ihm an | ✅ |
| Fertig wieder öffnen (`releaseLock`), danach erhält Ben die Sperre | ✅ (Protokolltest) |
| Fertig nur bei Alleinautorschaft (Mitautor → abgelehnt) | ✅ (Protokolltest) |
| Absatz-ID ohne Hilfe des Browsers bestimmen | ⚠️ Die Cursor-Nachricht (`<n>;base64(int32 Länge, UTF-16-ID, int32 Pos)`) enthält nur die ID des Textlaufs, nicht des Absatzes; im schnellen Modus fragt der Texteditor beim Tippen keine Absatzsperren an. Der Fertig-Knopf muss die Absatz-ID im Editor-iframe auslesen (M1). Ein erster Versuch über `AscCommon` im iframe fand das Objekt noch nicht |
| Einfügen im Editor wird erfasst und an den Server gemeldet | ✅ eingebaut, im Spike nur per Code geprüft |
| Speichern im strengen Modus (Änderungen erst beim Speichern verteilen) | ❌ noch nicht: nach `saveLock:false` sendet der Editor keine Änderungen. Für Collegare nicht nötig, weil der schnelle Modus genügt |
| Folien als fertig sperren | ⚠️ offen: Im schnellen Modus fragte der Präsentationseditor beim Tippen keine Sperren an, daher kennt der Server die Folien-ID noch nicht. Lösung in M1: der Fertig-Knopf liest die aktuelle Folie im Editor-iframe aus und schickt sie mit |

Serverseitige Protokolltests: `cd server && pnpm test` (9 Tests).
Browsertest zum Nachvollziehen: `node scripts/m0-zwei-browser.cjs docx` bzw. `pptx`.

## Was das für die Architektur heißt

1. **Weiter mit dem eigenen Server.** Der Editor arbeitet mit den nachgebauten Nachrichten zuverlässig zusammen;
   ein vollständiger Document Server ist nicht nötig.
2. **Fertig-Sperre:** funktioniert, weil der Editor vom Server gemeldete Sperren auch im schnellen Modus achtet.
   Die Sperre ist kooperativ (ein manipulierter Browser könnte trotzdem Änderungen senden). Deshalb bleibt es bei der
   Konzeptentscheidung, Abschnitte als eigene Dokumente zu führen: Schreibrechte je Abschnitt prüft der Server hart,
   die Absatzsperre ist die feinere, weiche Stufe.
3. **Autorschaft je Absatz** kennt der Server im schnellen Modus noch nicht, weil keine Absatzsperren angefragt
   werden. Er muss die Objekt-IDs aus den Änderungspaketen lesen oder der Browser liefert sie mit; das ist für die
   Prüfung „allein bearbeitet“ und für die Zeitleiste (M3) nötig. Bis dahin gilt die Prüfung nur auf Abschnittsebene.

## Noch nicht gelöst (in M1/M3)

- Dauerhafte Speicherung von Änderungen und Sperren in MariaDB, Snapshots mit nativem `x2t` (liegt im Image unter
  `server/FileConverter/bin`), damit nicht jede Sitzung alle Änderungen seit Beginn lädt.
- Gemeinsame Bilder: Eingefügte Bilder liegen im Spike nur im Browser der einfügenden Person (Blob-URL); sie müssen
  auf den Server hochgeladen werden.
- Anmeldung: Im Spike kommt der Name aus der Adresse. Ab M1 nur noch mit Sitzungs-Token.
- Anzeige der Fertig-Sperre: Der Editor zeigt „Guest“ als Sperrinhaber; besser „Fertig – Anna“.
