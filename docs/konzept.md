# Collegare – Konzept

**Prozessorientiertes kooperatives Projekt-Framework für gutes wissenschaftliches Arbeiten**
Eigenständige Webapp und externes Werkzeug für Moodle (LTI 1.3 / LTI Advantage), später mit Autogra.fi kombinierbar.

Stand: 1. November 2026 · Status: Entwurf zur Rückmeldung, noch keine Implementierung

---

## 0. Worum es geht und was dieses Dokument ändert

Collegare begleitet Gruppen (oder Einzelne) durch eine Projektarbeit von der Themenfindung bis zur Verteidigung. Es soll den **Prozess** sichtbar machen, nicht nur das Ergebnis: Wer hat was beigetragen, woher stammen Texte und Ideen, welche Hilfsmittel und KI-Werkzeuge wurden genutzt. Lehrkräfte bekommen dadurch eine faire Grundlage für die Bewertung der Eigenleistung, Lernende eine Struktur, die gutes wissenschaftliches Arbeiten einübt.

Gegenüber der ursprünglichen Skizze schlägt dieses Dokument vor allem vor:

1. **Abschnitte als eigene Einheiten.** Die Ausarbeitung besteht aus einzelnen Abschnitts-Dokumenten, die aus der Gliederung entstehen und erst beim Lesen oder Export zusammengesetzt werden. Damit lassen sich Sperren, Autorschaft, Revisionshistorie und Einzelbewertung auf dem Server durchsetzen statt nur im Browser (Abschnitt 5.3).
2. **Echtzeit-Kollaboration über das OnlyOffice-Protokoll.** office-website emuliert den OnlyOffice-Dokumentenserver komplett im Browser (`utils/editor/socket.ts`, `server.ts`). Collegare ersetzt diese Emulation durch einen echten, schlanken Kollaborationsserver. Das Sperrprotokoll von OnlyOffice (`getLock` je Absatz/Folie) wird so zur technischen Grundlage der Fertig-Sperre. Weil das Protokoll nicht offiziell dokumentiert ist, beginnt die Umsetzung mit einem **Spike** (Abschnitt 9, M0) mit klarer Ausstiegsoption.
3. **Gruppen aus Moodle nur eingeschränkt per Standard.** NRPS liefert Teilnehmende und Rollen, aber im Moodle-Standard keine Gruppen. Der Gruppenabgleich braucht einen zusätzlichen Weg (Abschnitt 3.3); die Kanban-Gruppenbildung in Collegare ist deshalb das führende Werkzeug.
4. **Tippfluss-Analyse eng begrenzt.** Sie bleibt optional mit doppelter Freischaltung, speichert nur zusammengefasste Merkmale, ergibt nur Hinweise an die Lernenden und nie eine automatische Bewertung (Abschnitt 6.2).
5. **Klare Kopplung an Autogra.fi** über eine Dienst-Schnittstelle für Texterkennung und KI, statt Code zu kopieren (Abschnitt 8).

Begriffe: *Projekt* = eine Aktivität (in Moodle: ein Ressourcen-Link), *Gruppe* = Team innerhalb eines Projekts, *Abschnitt* = Teil der Ausarbeitung, *Logbuch* = Prozess-Dokumentation.

---

## 1. Grundlage: office-website

[lasjoh-toho/office-website](https://github.com/lasjoh-toho/office-website) (Fork von ZIZIYI Office) ist die Basis für Oberfläche und Editoren.

| Was office-website mitbringt | Bedeutung für Collegare |
|---|---|
| Next.js 16, React 19, Tailwind 4, Radix UI, Lucide, Zustand, next-intl (inkl. `de.json`) | Frontend-Stack und Look werden übernommen (Sidebar, Kopfzeile, Karten, Dark Mode, Mobil-Navigation). |
| OnlyOffice-Editoren (Text, Tabelle, Präsentation, PDF) laufen vollständig im Browser, Umwandlung per `x2t` als WebAssembly | Ausarbeitung, Präsentation und Handout entstehen in vertrauten Office-Editoren mit DOCX/PPTX/PDF-Export. |
| Ein *MockSocket* und *EditorServer* spielen im Browser den Dokumentenserver: `auth`, `saveChanges`, `getLock`, `documentOpen` | Genau diese Nachrichten implementiert der Collegare-Kollaborationsserver echt (Abschnitt 7.2). |
| XHR-/fetch-Proxy in den Editor-iframe (gleicher Ursprung) | Collegare kann im Editor Einfüge- und Tastatur-Ereignisse erfassen (Abschnitt 6). |
| IndexedDB (`idb`), lokale Dateiliste | Grundlage für offline-fähige Notizen auf dem Handy. |
| Docker-Build mit Caddy, statischer Next-Export, OnlyOffice-Assets aus dem `documentserver`-Image | Betriebsmodell wird übernommen und um Backend und Datenbank ergänzt. |
| Lizenz **AGPL-3.0** | Collegare wird ebenfalls AGPL-3.0. Autogra.fi-Code (EUPL-1.2) darf übernommen werden, die EUPL erlaubt die Weitergabe unter AGPL-3.0. Die Kopplung über eine Netzschnittstelle berührt keine der beiden Lizenzen. |

Entfernt oder abgeschaltet werden: Uppy-Anbindung an Google Drive, Dropbox und OneDrive (Datenschutz an Schulen), Browser-Erweiterungshinweise, Vorlagen-Galerie von ziziyi.com, Analytics. Die Plugin-Galerie von OnlyOffice wird auf freigegebene, lokal ausgelieferte Plugins beschränkt.

### 1.1 Design-Vorlage für Kanban, Mindmap und Notizen: brausa

Für Kanban, Mindmap und Notiz-Thread ist [lasjoh-toho/brausa](https://github.com/lasjoh-toho/brausa) die Vorlage (Hinweis Jo, 1. November 2026). brausa hat genau diese Bausteine schon als „Projekt als Arbeitsraum“ (`docs/KONZEPT-PROJEKTRAUM.md`) gelöst:

| brausa | Übernahme in Collegare |
|---|---|
| **Projekt-Startseite** mit Kacheln (Dateien, Notizen & Snippets, Pinboard, Kanban mit Zählern, Wikis) | Startseite eines Projekts bzw. einer Gruppe: Kacheln für Phase, Mindmap, Notizen, Quellen, Ausarbeitung, Logbuch, Feedback, jeweils mit Zählern und offenen Punkten |
| **Kanban:** Spalten mit farbigem Punkt, Titel, Zähler, „+“ und Einstellungen; zart eingefärbte Spaltenflächen; Ablagezone „hierher ziehen zum Entfernen“; Auswahl-Leiste unten (Anzahl, Vorschau, Aktionen); Bahnen (Swimlanes) | Phase 0 Gruppenbildung (Säule = Thema, Karte = Person), später Aufgaben-Kanban der Gruppe (Offen · In Arbeit · Erledigt) |
| **Map (Pinboard):** gepunktete Fläche, Karten mit farbiger Kopfleiste und Markdown-Text, **Karten in Karten** (Rahmen mit Unterkarten), Pfeile zwischen Karten, Hineintauchen in eine Karte, Umschalter Map/Kanban, Rückgängig/Wiederholen, Vollbild | Mindmap in Phase 1: Karten frei verteilen, durch Hineinziehen in eine Rahmenkarte clustern; Pfeile für Zusammenhänge |
| **Outline-Ansicht:** dieselben Karten als eingerückte Liste, Tab/⇧Tab zum Ein- und Ausrücken | Die Gliederung der Ausarbeitung ist die Outline der Mindmap: Cluster → Abschnitt, Unterkarte → Unterabschnitt. Kein Kopieren, sondern zwei Sichten auf dieselben Daten |
| **Notes & snippets** als Thread am rechten Rand: Eingabefeld oben, neueste Einträge, Karten auf die Map ziehen oder „Platzieren“, Karten von der Map zurück in den Thread | genau der Notiz-Thread aus Phase 2: Notizen und Fotos vom Handy erscheinen dort und werden auf die Mindmap oder einen Abschnitt gezogen |
| **Abspielen** (▷) eines Pfads durch die Karten | Ausgangspunkt für einen Präsentationsentwurf in Phase 4 (Reihenfolge der Karten → Folienfolge) |
| Farb- und Formsprache: ruhige Flächen (`--bg #fbfbfa`, `--bg-sunken #f2f2f0`), Akzent `#2f6bff`, Radius 10 px, Inter 13 px, dunkles Farbschema | wird als Tailwind-Theme hinterlegt und mit dem Look von office-website zusammengeführt (beide sind hell, ruhig, mit Seitenleiste) |

brausa ist in Svelte geschrieben, Collegare (wie office-website) in React. Übernommen werden Gestaltung, Interaktionen und Datenmodell (Karte, Unterkarten, Link, Status, Notiz); die Komponenten werden in React nachgebaut. Wo brausa Dinge löst, die für Schulen nicht passen (Dateisystem, TiddlyWiki-Export), entfallen sie.

**Oberflächen-Regel:** Collegare folgt dem Look von office-website. Teile, die aus Autogra.fi kommen (Handy-Scanner mit Seitenerkennung, QR-Kopplung, Zugangscodes), behalten ihre dort erarbeitete Bedienung. Jede Abweichung davon wird im README begründet.

---

## 2. Rollen und Betriebsarten

### 2.1 Rollen

| Rolle | Darf |
|---|---|
| **Administration (Schule)** | Instanz einrichten, Moodle-Plattformen registrieren, KI-Dienste und Texterkennung anbinden, Tippfluss-Analyse schulweit erlauben, Aufbewahrungsfristen festlegen. |
| **Lehrkraft** | Projekte anlegen, Phasen und Termine steuern, Gruppen bilden, Funktionen (KI, Tippfluss, Peer-Review) je Projekt freischalten, Sperren aufheben, alles einsehen, Feedback und Bewertung. |
| **Lernende** | In der eigenen Gruppe arbeiten, Abschnitte als fertig markieren, Logbuch führen, Reviews schreiben, eigenes Feedback sehen. |
| **Gruppenrolle** (frei benannt, z. B. Koordination, Recherche, Layout) | Keine zusätzlichen Rechte, sondern dokumentierte Verantwortung; sie wird mit Abschnitten und Aufgaben verknüpft. |

Rechte gelten je Kontext (Schule › Kurs › Projekt › Gruppe), wie in autografi-kern (`Access\AccessControl`, `RoleCatalog`).

### 2.2 Betriebsarten

| Betriebsart | Anmeldung | Personen und Gruppen |
|---|---|---|
| **Moodle (LTI 1.3)** | Start aus einer Aktivität „Externes Tool“ | Teilnehmende per NRPS, Gruppen siehe 3.3, Noten per AGS zurück |
| **Eigenständig** | Lehrkraft mit lokalem Konto (wie Autogra.fi-Portal), Lernende per QR-Code oder 6-stelligem Code | Klassenliste von Hand oder per CSV |
| **Gemischt** | Lehrkraft aus Moodle, einzelne Lernende ohne Moodle-Konto per QR | beides in einem Projekt |

---

## 3. Moodle-Integration (LTI 1.3 / LTI Advantage)

### 3.1 Start und Anmeldung

Übernahme des erprobten Musters aus autografi-kern (`src/Lti/LtiService.php`):

- OIDC-Login-Initiierung `/lti/login` → Plattform → `id_token` per `form_post` an `/lti/launch`; Prüfung von Signatur (JWKS der Plattform), `iss`, `aud`, `azp`, `nonce` (einmalig), `state` (10 min), `deployment_id`.
- Eigenes Schlüsselpaar, ausgeliefert unter `/lti/jwks`.
- Rollenabbildung wie in Autogra.fi: Instructor, TeachingAssistant, ContentDeveloper, Administrator → Lehrkraft im Kurs (Moodle-Admins bekommen **keine** Systemrechte); Learner → Lernende.
- Ressourcen-Link ↔ Projekt: Beim ersten Start verknüpft die Lehrkraft die Aktivität mit einem neuen oder bestehenden Projekt (Muster „Aktivität im Kurs“ aus Autogra.fi).
- Startcontainer „Neues Fenster“ als Empfehlung, weil Safari auf iPads Cookies im iframe blockiert. Einbettung per `FRAME_ANCESTORS` bleibt möglich.
- Deep Linking 2.0 (optional, M6): Lehrkraft legt Projekt direkt aus der Moodle-Aktivitätsauswahl an.

### 3.2 Teilnehmende (NRPS)

Beim Start durch eine Lehrkraft wird `context_memberships_url` gespeichert (wie autografi-kern, Migration 18). „Aus Moodle übernehmen“ holt alle aktiven Lernenden mit Scope `contextmembership.readonly`. Importierte Personen behalten Issuer + Moodle-ID, damit ein späterer Start dieselbe Person ergibt. Der Abgleich läuft bei jedem Lehrkraft-Start im Hintergrund erneut; Ausgetretene werden markiert, nicht gelöscht.

### 3.3 Gruppen aus Moodle

Die Skizze sieht vor, Moodle-Gruppen per NRPS auszulesen. **NRPS kennt im Standard keine Gruppen**, und der 1EdTech-Gruppendienst (Course Groups) ist in Moodle nach meinem Stand nicht enthalten; das wird im Spike geprüft. Vorschlag in dieser Reihenfolge:

1. **Gruppenbildung in Collegare** (Phase 0, Kanban) ist der Normalfall und funktioniert in allen Betriebsarten.
2. **Import aus Moodle-Gruppen** als Zusatz, wenn die Schule es will: über die Moodle-Webservices `core_group_get_course_groups` und `core_group_get_group_members` mit einem Token je Plattform, oder über eine kleine Erweiterung des vorhandenen Moodle-Plugins (`mod_securelink_QR`). Importierte Gruppen erscheinen als vorbelegte Säulen und bleiben danach in Collegare änderbar.
3. Rückschreiben von Gruppen nach Moodle ist nicht vorgesehen.

### 3.4 Noten (AGS)

- Je Projekt eine Hauptspalte (Gesamtergebnis). Optional legt Collegare per AGS-Lineitems weitere Spalten an, z. B. „Prozess“, „Produkt“, „Präsentation“ (Kategorien aus Abschnitt 6.6).
- Übertragung erst nach ausdrücklicher Freigabe durch die Lehrkraft, asynchron über die Warteschlange (wie `AgsScoreHandler`), mit Wiederholung und sichtbarem Fehlerstatus.
- Zwischenfeedback kann als Kommentar (`comment`) zur Spalte gehen, ohne Punkte (`activityProgress: InProgress`, `gradingProgress: Pending`).
- Die Gruppenbewertung wird je Person übertragen, weil Moodle-Noten personenbezogen sind (Abschnitt 6.6).

---

## 4. Didaktischer Prozess: Phasen

```
Phase 0        Phase 1          Phase 2          Phase 3              Phase 4
Gruppen   →    Orientierung  →  Recherche    →   Ausarbeitung     →   Präsentation
(Kanban)       (Mindmap,        (Notizen,        (Abschnitte,         (Folien, Handout,
               Gliederung,      Quellen,         Feedback,            Ausarbeitung,
               Rollen)          Fotos)           Peer-Review)         Verteidigung)
──────────────────────── prozessbegleitend: Logbuch · Protokoll · Zeitleiste ────────────────────────
```

Allgemein für alle Phasen:

- Die Lehrkraft stellt je Phase ein: freigeschaltet ab / Zieltermin / verpflichtende Ergebnisse (Meilensteine). Phasen sind **nicht hart gesperrt**: Gruppen können zurückgehen (Gliederung ändern, Quelle nachtragen). Ein Wechsel wird protokolliert.
- Jede Phase endet mit einem sichtbaren Meilenstein (z. B. „Gliederung eingereicht“), zu dem die Lehrkraft Zwischenfeedback geben kann.
- Eine Phasenleiste oben zeigt jeder Gruppe, wo sie steht und was noch fehlt.

### Phase 0: Gruppenbildung

Startseite der Lehrkraft für ein Projekt ist ein **Kanban-Board**:

- Erste Säule „Noch ohne Gruppe“ mit allen Lernenden (aus Moodle importiert oder per QR-Zugang angemeldet). Weitere Säulen = Themen bzw. Gruppen; die Überschrift ist das Thema.
- Lehrkraft zieht Lernende in Säulen. Alternative ohne Ziehen (Barrierefreiheit, Tastatur, Screenreader): Menü an jeder Karte „Verschieben nach …“.
- Lernende einer Säule können das Thema nachträglich setzen oder ändern, solange die Lehrkraft das erlaubt.
- **Vorschlag (neu):** Wahlmodus, in dem sich Lernende selbst einer Säule zuordnen, mit Höchstzahl je Säule und Schluss-Termin.
- **Einzelmodus:** Jede Person erhält einen Einzelzugang und tippt ihr Thema selbst. Alle weiteren Phasen funktionieren gleich, Peer-Review läuft dann zwischen Einzelpersonen.
- QR-Zugang wie Autogra.fi-Portal: Code je Person, Geheimnis im URL-Fragment, Ablaufzeit, Sperren möglich; Namen bleiben bei der Lehrkraft.

### Phase 1: Orientierung und Themendefinition

- **Mindmap-Fläche:** Karten (Text, Bild, Link, Notiz) frei auf einer Fläche, dann zu Clustern zusammenschieben; Cluster bekommen einen Titel. Gemeinsame Echtzeit-Bearbeitung mit sichtbaren Cursorn.
- **Gliederung aus Clustern:** „Gliederung übernehmen“ macht Cluster zu Abschnitten (umsortierbar, Unterabschnitte möglich). Die Gliederung ist das zentrale Gerüst für Phase 2 bis 4.
- **Themenabgrenzung:** kurze Pflichtfelder Forschungsfrage, Abgrenzung, erwartetes Ergebnis.
- **Rollen:** Jedes Mitglied bekommt mindestens eine Gruppenrolle und eine Zuständigkeit für Abschnitte. Bestätigung durch alle Mitglieder („verbindlich“), Änderungen später nur mit Protokolleintrag.
- Meilenstein: Gliederung und Rollen eingereicht.

### Phase 2: Recherche und Methodik

- **Notiz-Werkzeug, mobil zuerst:** Text, Foto, Sprachnotiz (optional), Link. Offline erfassbar und später synchronisiert. Auf dem Handy per QR-Kopplung mit dem Rechner, wie der Autogra.fi-Scanner.
- **Notiz-Thread am rechten Rand der Mindmap:** Neue Notizen und Fotos erscheinen dort chronologisch als Karten und lassen sich auf die Fläche oder direkt auf einen Abschnitt der Gliederung ziehen.
- **Gemeinsame Literaturliste:** Eintrag per DOI/ISBN/URL (Metadaten-Abfrage über freie Dienste wie Crossref, abschaltbar), von Hand oder per BibTeX-Import. Gespeichert als CSL-JSON, damit Zitierstile (APA, DIN ISO 690, Chicago) beim Export funktionieren.
- **Quellennachweis:** Quellen und Zitate (mit Seitenangabe) werden Abschnitten zugeordnet. Eine Übersicht zeigt Abschnitte ohne Quellen.
- **Methodik:** kurzer Abschnitt in der Gliederung mit Vorlage, je nach Fach anpassbar.
- Meilenstein: Quellenbasis mit mindestens N Quellen (von der Lehrkraft eingestellt).

### Phase 3: Ausarbeitung und Feedback

- **Handschriftliche Notizen:** Foto mit Seitenerkennung und Unschärfe-Warnung (Autogra.fi `detect.js`, `quality.js`), dann Texterkennung (Abschnitt 8). Ergebnis ist eine Textnotiz mit dem Foto daneben, korrigierbar.
- **Notizen ordnen:** Notizen eines Abschnitts in eine Reihenfolge ziehen; „Entwurf aus Notizen beginnen“ übernimmt sie als Startmaterial in das Abschnitts-Dokument. Diese Übernahme gilt als **interne Herkunft** und löst keine Einfüge-Warnung aus.
- **Drafting:** Jeder Abschnitt ist ein eigenes Textdokument im OnlyOffice-Editor; die Gesamtansicht setzt alle Abschnitte in Gliederungsreihenfolge zusammen.
- **KI-Feedback** (nur wenn freigeschaltet): Rückmeldung zu Gliederung, Argumentation, Quellenbezug und Sprache je Abschnitt, entlang der Bewertungskriterien. Jede Nutzung erscheint automatisch im Logbuch. Grenzen je Person, keine Namen im Prompt (Muster `TextMinimizer`).
- **Peer-Review:** Lehrkraft stellt ein: innerhalb der Gruppe oder gruppenübergreifend, anonym oder offen, mit Leitfragen. Reviews sind Kommentare am Text plus ein kurzer Bogen. Die Autorin bzw. der Autor antwortet auf jedes Review („übernommen“, „nicht übernommen, weil …“); das ist selbst Teil der Prozessdokumentation.
- Meilenstein: Entwurf aller Abschnitte, Reviews abgeschlossen.

### Phase 4: Präsentation und Verteidigung

- **Präsentation:** PPTX im OnlyOffice-Präsentationseditor mit Collegare-Vorlagen (wenig Text, große Bilder, Quellenfolie automatisch aus der Literaturliste). Folien werden Mitgliedern zugeordnet.
- **Handout:** gestaltete Vorlage (1–2 Seiten) im Texteditor oder als Layout-Vorlage mit Feldern (Kernaussagen, Grafik, Quellen).
- **Wissenschaftliche Ausarbeitung im Tufte-/Quarto-Stil:** Export der zusammengesetzten Abschnitte über DOCX → Pandoc → Quarto mit Randnotizen, Randabbildungen und Literaturverzeichnis aus CSL-JSON; Ausgabe als HTML und als PDF über Typst (ohne LaTeX-Installation). Läuft serverseitig in der Warteschlange.
- **Verteidigung:** Probelauf-Modus mit Zeitnahme je Person; Sammlung erwarteter Fragen (von der Gruppe, optional mit KI-Vorschlägen); Notizfeld der Lehrkraft während der Verteidigung, das in die Bewertung einfließt.
- Meilenstein: Abgabe der Endprodukte. Danach ist alles schreibgeschützt (außer nach Freigabe durch die Lehrkraft).

### Prozessbegleitend: Logbuch und Reflexion

- **Logbuch (Lerntagebuch), verpflichtend:** Einträge mit Datum, Tätigkeit, Zeitaufwand, genutzten Hilfsmitteln und Reflexion. Fotos handschriftlicher Notizen lassen sich anhängen (mit Texterkennung).
- **KI-Transparenz:** Eintragstyp „KI genutzt“ mit Werkzeug, Prompt, Ergebnis (Text oder Datei) und Verwendung. Innerhalb von Collegare genutzte KI erzeugt diesen Eintrag automatisch.
- **Konsolidierung:** Am Ende erstellt Collegare ein Prozess-Logbuch je Person und Gruppe (PDF), das Logbuch, Meilensteine, Einfüge-Erklärungen, Reviews und Antworten zusammenführt.
- Die Lehrkraft kann Reflexionsimpulse je Phase vorgeben.

---

## 5. Kooperations- und Bearbeitungsrechte (Sperrfunktion)

### 5.1 Ziel

Fertige Teile Einzelner sollen vor versehentlichem Überschreiben geschützt sein, und die Lehrkraft soll erkennen, wer was erarbeitet hat.

### 5.2 Regeln

| Zustand | Wer bearbeitet | Andere Mitglieder |
|---|---|---|
| **In Arbeit** | alle zuständigen Mitglieder | bearbeiten, wenn Abschnitt der Gruppe offen steht; sonst kommentieren |
| **Fertig** | niemand | lesen, kommentieren, Änderungsvorschläge (Modus „Änderungen nachverfolgen“) |
| **Wieder geöffnet** | wie „In Arbeit“ | wie „In Arbeit“ |

- „Fertig“ markieren darf, wer an dem Abschnitt, Absatz oder der Folie **allein** gearbeitet hat; das prüft der Server anhand der Revisionshistorie. Gibt es Mitautorinnen oder -autoren, müssen alle zustimmen.
- Wieder öffnen: die Person selbst, oder andere nach ihrer ausdrücklichen Freigabe, oder die Lehrkraft. Jeder Wechsel steht mit Grund im Protokoll.
- Änderungsvorschläge anderer an fertigen Teilen landen als nachverfolgte Änderungen; die Autorin bzw. der Autor nimmt sie an oder lehnt sie ab. So bleibt Zusammenarbeit möglich, ohne die Sperre aufzuheben.
- Nach der Endabgabe (Phase 4) ist alles gesperrt.

### 5.3 Technische Durchsetzung

- **Abschnitte** sind eigene Dokumente. Schreibrechte prüft der Kollaborationsserver beim Öffnen und bei jedem `saveChanges`. Damit ist die Sperre serverseitig durchgesetzt, nicht nur in der Oberfläche.
- **Absätze innerhalb eines Abschnitts und Folien** nutzen das Sperrprotokoll von OnlyOffice: Ein Client muss vor dem Bearbeiten eines Blocks (Absatz, Folie) `getLock` anfragen. Der Server verweigert die Sperre für fertige Blöcke, und der Editor erlaubt dann keine Bearbeitung. Zusätzlich prüft der Server, ob eingehende Änderungen nur Blöcke betreffen, für die der Absender eine Sperre hält (im Spike zu klären, wie zuverlässig das am Änderungsformat erkennbar ist).
- Absätze lassen sich zusätzlich als **Inhaltssteuerelement** mit Sperrattribut markieren, damit die Sperre auch in exportierten DOCX-Dateien sichtbar bleibt.

---

## 6. Protokollierung und Umgang mit Auffälligkeiten

Grundsatz: Collegare **macht den Entstehungsprozess sichtbar und fragt nach**, es urteilt nicht. Alle Hinweise gehen zuerst an die Lernenden, mit der Möglichkeit, die Herkunft zu erklären. Es gibt keine automatische Bewertung und keinen „Betrugsverdacht“-Score (DSGVO Art. 22, Fehlalarme).

### 6.1 Einfüge-Protokoll (Paste-Detection)

- Erfasst werden Einfüge-Ereignisse im Editor-iframe (gleicher Ursprung, daher möglich): Zeitpunkt, Länge, Zielabschnitt, Prüfsumme und Auszug des Textes, Herkunft (intern aus Collegare oder extern).
- Interne Herkunft (eigene Notiz, Logbuch, anderer Abschnitt der Gruppe, Texterkennung) wird über eine Herkunftsmarke in der Zwischenablage erkannt und nicht beanstandet.
- Ab einem einstellbaren Schwellenwert (Standard: 200 Zeichen, je Projekt änderbar) fragt ein Dialog nicht-blockierend: *Woher stammt der Text?* → Zitat aus Quelle (Auswahl aus Literaturliste, Seitenangabe; Zitat wird gekennzeichnet) · eigener Vorentwurf (Upload anbieten) · KI-Werkzeug (Logbuch-Eintrag mit Prompt vorausgefüllt) · Sonstiges (Freitext). Die Antwort wird gespeichert; „später“ ist erlaubt, offene Erklärungen bleiben als Erinnerung sichtbar.
- In der Zeitleiste sind Einfügungen markiert.

### 6.2 Tippfluss-Muster (Typing Pattern Analytics)

**Nur wenn Administration (schulweit) und Lehrkraft (je Projekt) es einschalten.** Lernende sehen dauerhaft, dass die Analyse aktiv ist, und werden vorab informiert.

- Gemessen werden zusammengefasste Merkmale je Schreibsitzung: Länge ununterbrochener Schreibsequenzen, Verteilung der Pausen, Anteil von Korrekturen. **Einzelne Tastenanschläge und deren Zeitstempel werden nicht gespeichert** (Datenminimierung).
- Erkennungslogik: lange, gleichmäßige Sequenzen ohne Denkpausen und mit sehr wenigen Korrekturen deuten auf Abtippen hin.
- Folge: ein freundlicher Hinweis an die Person: Quelle notieren oder Vorfassung hochladen. Die Lehrkraft sieht, dass ein Hinweis kam und wie er beantwortet wurde, aber keine Punktzahl.
- **Ausnahmen:** Diktiersoftware, Bildschirmtastaturen und andere Hilfsmittel erzeugen genau solche Muster. Die Lehrkraft kann die Analyse je Person abschalten (Nachteilsausgleich), ohne den Grund im System zu nennen.
- Vor dem Einsatz an einer Schule ist eine Datenschutz-Folgenabschätzung nötig; Collegare liefert dafür eine Vorlage mit.

### 6.3 Logbuch

Siehe Abschnitt 4 (prozessbegleitend). Pflichtcharakter: Die Lehrkraft stellt eine Mindestanzahl Einträge je Phase ein; fehlende Einträge erscheinen in der Phasenleiste.

### 6.4 Revisionshistorie und Zeitleiste

- Jede Änderung wird mit Person und Zeit gespeichert: Abschnitts-Dokumente als OnlyOffice-Änderungspakete, Mindmap, Notizen und Kanban als CRDT-Aktualisierungen.
- **Zeitleiste (Time Slider):** Schieberegler über die gesamte Projektdauer; zeigt den Stand eines Abschnitts oder der Mindmap zu jedem Zeitpunkt, mit Spuren für Ereignisse (Einfügungen, Logbuch, Fertig-Markierungen, Reviews, KI-Nutzung). Abspielen als Zeitraffer.
- **Beitragsübersicht:** Anteil je Person an Text (eingetippt, eingefügt mit Erklärung, eingefügt ohne Erklärung, gelöscht), an Folien, Notizen, Quellen und Logbuch. Als Grundlage für ein Gespräch, nicht als Note.
- Lehrkräfte sehen alles; Lernende sehen die Zeitleiste ihrer Gruppe.

### 6.5 Prüfprotokoll

Sicherheitsrelevante Vorgänge (Anmeldungen, Rechteänderungen, Sperren aufheben, Bewertungen, Freigaben, Exporte) stehen in einem hash-verketteten Protokoll wie in autografi-kern (`Audit\AuditLog`), getrennt von den Inhaltsdaten und mit eigener Aufbewahrungsfrist.

### 6.6 Bewertung

- **Konfigurierbare Kategorien** je Projekt, z. B. Prozess (Logbuch, Meilensteine, Reviews), Produkt (Ausarbeitung), Präsentation, Verteidigung. Je Kategorie: Gewicht, Skala, Kriterien mit Beschreibung, **Gruppen- oder Einzelbewertung**.
- Einzelnote = Gruppenanteil + Einzelanteile, für Lernende nachvollziehbar dargestellt. Die Lehrkraft kann den Gruppenanteil je Person begründet anpassen.
- Vorlagen für Kategorien und Kriterien lassen sich speichern und zwischen Projekten teilen.
- **Zwischenfeedback:** je Meilenstein an Gruppe oder Person, als Entwurf vorbereitet und ausdrücklich veröffentlicht; Lernende sehen es in der Phasenleiste und bestätigen das Lesen.
- Endbewertung: Entwurf → Freigabe → Übertragung an Moodle (AGS) bzw. Export (CSV/PDF) im Einzelbetrieb.

### 6.7 KI-Unterstützung beim Feedback (Lehrkraft)

Wenn freigeschaltet, erstellt die KI einen **Feedback-Entwurf** aus: Bewertungskriterien, Produkt (Abschnitte, Folien), Korrekturnotizen der Lehrkraft, bisherigem Zwischenfeedback, Logbuch und Reviews. Die Lehrkraft bearbeitet den Entwurf; nichts wird automatisch veröffentlicht. Namen werden vor dem Versand ersetzt. Quellenangaben im Entwurf zeigen, worauf sich ein Satz stützt (wie „KI-Feedback-Quellen“ in Autogra.fi).

---

## 7. Technische Architektur

### 7.1 Überblick

```
Browser (Next.js-Export aus office-website)
 ├─ Projektoberfläche: Kanban, Mindmap, Notizen, Gliederung, Quellen, Logbuch, Bewertung
 ├─ OnlyOffice-Editoren (sdkjs/web-apps, x2t-WASM) im iframe
 └─ PWA für Handy: Notizen offline (IndexedDB), Kamera, QR-Kopplung
        │  HTTPS (REST /api/v1)       │  WebSocket (socket.io)
        ▼                             ▼
Caddy ─► Collegare-Server (Node.js, TypeScript)
          ├─ LTI 1.3 (Login, Launch, JWKS, NRPS, AGS, Deep Linking)
          ├─ REST-API, Rechteprüfung je Kontext
          ├─ Kollaborationsserver
          │    ├─ OnlyOffice-Protokoll (auth, saveChanges, getLock, …) für Dokumente/Folien
          │    └─ Yjs-Sync für Mindmap, Kanban, Notizen, Gliederung
          ├─ Warteschlange + Worker: Texterkennung, KI, Export (Pandoc/Quarto/Typst, x2t nativ), AGS
          └─ Prüfprotokoll
        │
        ├─ MariaDB (Metadaten, Änderungspakete, Ereignisse)
        ├─ Dateispeicher (lokal oder S3-kompatibel): Fotos, Snapshots, Exporte
        └─ KI/OCR: OpenAI-kompatibler Dienst (Ollama, lokal) und/oder Autogra.fi-Dienstschnittstelle
```

### 7.2 Kollaborationsserver für die Office-Editoren

office-website zeigt, welche Nachrichten der OnlyOffice-Client erwartet. Collegare implementiert sie auf dem Server:

| Nachricht | Verhalten in Collegare |
|---|---|
| `auth` | Sitzungs-Token prüfen, Rechte ermitteln (bearbeiten, kommentieren, nur lesen), Teilnehmende und bestehende Sperren melden, bisherige Änderungen seit dem letzten Snapshot mitsenden (`authChanges`) |
| `saveChanges` | Rechte und Sperren prüfen, Paket mit Person, Zeit, laufender Nummer speichern, an andere Teilnehmende verteilen |
| `getLock` / `releaseLock` | Sperre für einen Block vergeben, außer der Block ist fertig oder von anderen gesperrt |
| `isSaveLock`, `unSaveLock` | Speichern serialisieren |
| Verbindungsabbruch | Sperren der Person nach Zeitablauf freigeben |

**Snapshots:** Nach N Änderungen oder beim Schließen erzeugt ein Worker mit dem nativen `x2t` aus dem `documentserver`-Image (AGPL, wie bei office-website) eine neue DOCX/PPTX-Fassung. Neue Teilnehmende laden den letzten Snapshot plus die Änderungen danach. Die Zeitleiste spielt Änderungspakete bis zu einem Zeitpunkt in einen schreibgeschützten Editor ein.

**Warum nicht ein vollständiger OnlyOffice Document Server?** Er würde Kollaboration fertig liefern, ist aber schwergewichtig (eigene Datenbank, RabbitMQ, Redis), hat in der Community-Version eine Begrenzung gleichzeitiger Verbindungen und erlaubt keinen Eingriff in Sperren, Einfügeereignisse und Historie. Er bleibt die **Ausstiegsoption**, falls der Spike scheitert.

### 7.3 Weitere Bausteine (Vorschlag, alle mit freier Lizenz)

| Zweck | Baustein |
|---|---|
| Echtzeit für Mindmap, Kanban, Notizen, Gliederung | Yjs (CRDT), offline-fähig, Zusammenführung nach Wiederverbindung |
| Mindmap-Fläche | eigene Komponente nach dem Vorbild der brausa-Map (Karten in Karten, Pfeile); React Flow (xyflow, MIT) nur, falls der Nachbau zu aufwendig wird |
| Kanban, Sortieren | dnd-kit (MIT), mit Tastaturbedienung |
| Backend | Node.js 22, Fastify, socket.io, Kysely, Zod |
| Datenbank | MariaDB (wie Autogra.fi), SQLite für Tests |
| Export | Pandoc, Quarto, Typst im Worker-Container |
| Literatur | CSL-JSON, citeproc-js |

### 7.4 Warum TypeScript im Backend (Abweichung von Autogra.fi)

Autogra.fi-Kern ist PHP (Slim 4). Für Collegare schlage ich Node.js mit TypeScript vor:

- Echtzeit-Kollaboration braucht dauerhafte WebSocket-Verbindungen; der OnlyOffice-Client spricht socket.io, Yjs hat fertige Node-Server. PHP-FPM kann das nicht ohne Zusatzdienst.
- Frontend und Backend teilen Typen und Validierung, und der Code aus office-website (`server.ts`, `types.ts`) lässt sich auf den Server übertragen.
- Preis: Die LTI-, Rechte- und Protokoll-Logik aus autografi-kern wird nach TypeScript übertragen statt wiederverwendet (überschaubar, etwa die Klassen in `src/Lti`, `src/Access`, `src/Audit`), und Node.js läuft als eigener Dienst auf der VM statt als PHP auf einem Webspace.

Die Alternative wäre PHP wie Autogra.fi plus ein separater Node-Dienst nur für Kollaboration. Das spart die Übertragung, bedeutet aber zwei Laufzeitumgebungen in einer App.

### 7.5 Datenmodell (Kern)

| Tabelle | Inhalt |
|---|---|
| `contexts`, `users`, `memberships` | Schule › Kurs › Projekt, Personen, Rollen (wie autografi-kern) |
| `lti_platforms`, `lti_links` | registrierte Moodle-Instanzen, Aktivität ↔ Projekt, NRPS/AGS-Adressen |
| `projects` | Titel, Modus (Gruppe/Einzeln), Phasen-Einstellungen, Funktionsschalter (KI, Tippfluss, Peer-Review) |
| `groups`, `group_members` | Gruppen mit Thema, Mitglieder mit Gruppenrollen |
| `boards` | Yjs-Dokumente für Kanban, Mindmap, Gliederung (Zustand + Aktualisierungen) |
| `notes`, `note_files` | Notizen, Fotos, Texterkennung, Herkunft |
| `sources`, `citations` | CSL-JSON-Quellen, Zuordnung zu Abschnitten mit Seitenangabe |
| `documents`, `doc_changes`, `doc_snapshots` | Abschnitte, Folien, Handouts; Änderungspakete; Fassungen |
| `blocks` | Zustand je Abschnitt/Absatz/Folie: in Arbeit, fertig, wieder geöffnet, Autorschaft |
| `process_events` | Einfügungen mit Erklärung, Tippfluss-Hinweise, Fertig-Markierungen |
| `logbook_entries` | Logbuch inkl. KI-Nutzung (Werkzeug, Prompt, Ergebnis) |
| `reviews`, `review_replies` | Peer-Reviews und Antworten |
| `criteria`, `gradings`, `feedback` | Kategorien, Bewertungen je Person/Gruppe, Zwischen- und Endfeedback |
| `jobs`, `ai_calls` | Warteschlange, KI-Nutzung mit Tokenzählung |
| `audit_log` | hash-verkettetes Prüfprotokoll |

### 7.6 Datenschutz und Sicherheit

- Datenhaltung in der Schule bzw. beim Schulträger; KI nur über freigegebene Dienste (Regionen wie `AI_ALLOWED_REGIONS` in Autogra.fi), Standard lokal per Ollama.
- Gruppenarbeit ist personenbezogen; eine pseudonymisierte Korrektur wie in Autogra.fi ist hier nicht sinnvoll (Zielkonflikt 2.5 der Ausschreibungsanalyse). Bei der Kopplung mit Autogra.fi gilt das für Collegare-Abgaben ausdrücklich.
- Aufbewahrungsklassen: Inhalte bis Projektende + Frist (Schule stellt ein), Tippfluss-Merkmale kürzer (Standard: bis zur Endbewertung), Prüfprotokoll eigene Frist; Löschjournal, damit Löschungen nach einem Restore erneut greifen.
- Auskunft und Export je Person (DSGVO Art. 15/20): alle eigenen Beiträge, Logbuch und Feedback als ZIP.
- QR-Geheimnisse im URL-Fragment, Rate-Limits, kurzlebige Sitzungstoken für den Kollaborationskanal; Token-Anmeldung auch für eine spätere App (Abschnitt 7.8).
- Barrierefreiheit: WCAG 2.2 AA als Ziel; für jede Zieh-Interaktion gibt es eine Tastatur-/Menü-Alternative.

### 7.7 Betrieb

**Ohne Docker, direkt auf der VM** (Entscheidung Jo, 1. November 2026: Autogra.fi läuft bereits in einer VM, eine zweite Verpackung bringt dort wenig). Ein GitHub-Workflow baut ein Release-Paket, das alles Fertige enthält: den Next.js-Export, die OnlyOffice-Assets und das native `x2t` (einmal beim Bauen aus dem `documentserver`-Image entnommen) sowie den übersetzten Server. Auf der VM laufen dann:

- Node.js 22 als systemd-Dienste `collegare` (Server) und `collegare-worker`,
- Caddy oder der vorhandene Webserver als Reverse-Proxy (statische Dateien, `/api`, `/lti`, `/socket.io`, TLS),
- MariaDB (dieselbe Instanz wie Autogra.fi möglich, eigene Datenbank),
- Pandoc, Quarto, Typst als Pakete bzw. Binärdateien für den Export (erst ab M5 nötig).

Ein Installationsskript richtet das ein; die Einrichtung im Browser folgt dem Vorbild der Autogra.fi-Installationsseite (Administrationskonto, Moodle-Verbindung, KI-Dienst). Updates = neues Paket entpacken, Dienst neu starten, Migrationen laufen beim Start. Ein Docker-Compose-Setup kann zusätzlich für Schulträger angeboten werden, die lieber Container betreiben, ist aber nicht Voraussetzung.

Der Server ist leicht, weil die Editoren und die Umwandlung im Browser laufen; Collegare kann auf derselben VM wie Autogra.fi laufen. Zielgröße für den Start: eine Schule, einige hundert gleichzeitige Nutzende, je Dokument 3–6 gleichzeitig Bearbeitende.

### 7.8 Plattformunabhängige App (langfristiges Ziel)

Collegare soll langfristig auch als installierbare App auf Handy, Tablet und Rechner laufen. Grundsatz: **eine Web-Codebasis**, keine eigene native App, weil die OnlyOffice-Editoren nur als Web-Code existieren.

| Stufe | Umsetzung | Nutzen |
|---|---|---|
| 1. PWA (ab M2) | installierbare Web-App, Notizen offline in IndexedDB, Kamera über den Browser | deckt den Großteil ab, ohne App-Stores |
| 2. Capacitor (langfristig) | derselbe Next.js-Export als iOS- und Android-App | Teilen-Menü („an Collegare senden“ für Fotos und Links), verlässlicher Offline-Speicher, Push-Hinweise (z. B. neues Zwischenfeedback), bessere Kamera; der Autogra.fi-Scanner kann mit hinein |
| 3. Tauri (nur bei Bedarf) | Desktop-App für Windows, macOS, Linux | meist reicht dort die PWA |

Damit das ohne Umbau möglich bleibt, gilt **von Anfang an**:

- Anmeldung über Tokens, nicht nur über Cookies. Die App startet nicht aus Moodle, sondern per QR-Code, Zugangscode oder Login im Systembrowser.
- Die Serveradresse ist einstellbar, weil jede Schule eine eigene Instanz betreibt; ein Schul-QR-Code kann sie setzen.
- Jede Funktion läuft über die REST-API bzw. den Kollaborationskanal, nichts nur über serverseitig gerenderte Seiten.

Risiken: OnlyOffice braucht auf älteren iPads viel Speicher (wird im Spike M0 gemessen); App-Store-Konten, Prüfungen und Updates sind laufender Aufwand. Langfristig liegt eine gemeinsame Schul-App für Autogra.fi und Collegare nahe.

---

## 8. Kopplung mit Autogra.fi

| Stufe | Inhalt |
|---|---|
| **Gleiche lokale Modelle** (ab M2) | Collegare spricht wie Autogra.fi einen OpenAI-kompatiblen Dienst an (gleiche Ollama-Instanz möglich). Konfiguration mit denselben Begriffen (Dienst-Karten, Verwendung, Region). |
| **Texterkennung über Autogra.fi** (ab M2, wenn vorhanden) | Autogra.fi bekommt eine Dienstschnittstelle, z. B. `POST /api/v1/service/ocr` (Bild → Zeilen und Text, Auftrag mit Statusabfrage), abgesichert mit einem Dienst-Token je Collegare-Instanz. So nutzt Collegare die dort gemessene Kette (kraken-Zeilen + Sprachmodell, Training) statt sie zu kopieren. Ohne Autogra.fi: direkt ein Sprachmodell mit Bildeingabe über Ollama. |
| **Gemeinsame KI-Vorlagen** (später) | Fach-Prompts und Schul-Systemprompts aus Autogra.fi lesen, damit Schulen KI an einer Stelle pflegen. |
| **Abgabe an Autogra.fi** (später) | Ein Endprodukt (z. B. Ausarbeitung als PDF) oder einzelne Leistungen werden als Leistungsnachweis an Autogra.fi übergeben und dort mit der bekannten Korrekturoberfläche bewertet. |
| **Gemeinsame Anmeldung** (später) | Beide Werkzeuge sind eigene LTI-Tools in Moodle; im Einzelbetrieb einheitliche Lehrkraft-Konten (OIDC oder gemeinsamer Kontodienst). |

---

## 9. Umsetzungsplan

| Meilenstein | Inhalt | Ergebnis / Abnahme |
|---|---|---|
| **M0 Spike** (zuerst) | Node-Server mit socket.io statt MockSocket; zwei Browser bearbeiten dieselbe DOCX und PPTX; Sperre je Absatz/Folie vom Server verweigern; Beitritt mit Änderungsverlauf; Snapshot mit nativem x2t; Einfüge-Ereignis im iframe erfassen. NRPS-Gruppen in Moodle prüfen. | Entscheidung: eigenes Protokoll weiter oder Ausstieg (OnlyOffice Document Server bzw. eigener Texteditor auf ProseMirror/Yjs für Abschnitte). |
| **M1 Fundament** | Repo aus office-website übernehmen, entschlacken, deutsch; Backend, Datenbank, Rechte, Prüfprotokoll; LTI-Start, NRPS-Import; lokale Konten und QR-Zugang; Phase 0 Kanban mit Einzelmodus | Start aus Moodle zeigt Projekt; Gruppen bilden auf dem Board |
| **M2 Orientierung und Recherche** | Mindmap, Gliederung, Rollen; Notizen mobil/offline mit Thread; Literaturliste; Fotos mit Texterkennung | Gruppe erstellt Gliederung aus Mindmap, Notizen vom Handy erscheinen live |
| **M3 Ausarbeitung** | Abschnitts-Dokumente, Gesamtansicht, Fertig-Sperre, Logbuch, Einfüge-Protokoll, Zeitleiste, Beitragsübersicht | Sperren greifen serverseitig; Zeitleiste spielt einen Abschnitt ab |
| **M4 Feedback und Bewertung** | Peer-Review, KI-Feedback für Lernende, Kategorien, Zwischenfeedback, KI-Entwurf für die Lehrkraft, AGS | Note und Zwischenkommentar landen im Moodle-Gradebook |
| **M5 Präsentation** | Folien- und Handout-Vorlagen, Quarto/Typst-Export, Verteidigungsmodus, Prozess-Logbuch als PDF | Export einer Beispielarbeit im Tufte-Stil |
| **M6 Optionales** | Tippfluss-Analyse (nach DSFA-Vorlage), Deep Linking, Moodle-Gruppenimport, Autogra.fi-Abgabe | jeweils einzeln abnehmbar |
| **Langfristig** | App für iOS/Android über Capacitor, ggf. Desktop über Tauri, gemeinsame Schul-App mit Autogra.fi (Abschnitt 7.8) | App aus dem Store verbindet sich per Schul-QR mit der eigenen Instanz |

---

## 10. Offene Fragen an Jo

1. **Backend-Sprache:** TypeScript/Node (Empfehlung, Abschnitt 7.4) oder PHP wie Autogra.fi plus separater Kollaborationsdienst?
2. **Betrieb:** geklärt, direkt auf der VM ohne Docker (Abschnitt 7.7). Offen: dieselbe VM wie Autogra.fi oder eine eigene?
3. **Gruppen aus Moodle:** Reicht die Gruppenbildung in Collegare, oder ist der Import vorhandener Moodle-Gruppen Pflicht (dann Webservice-Token oder Plugin-Erweiterung)?
4. **Sperr-Granularität:** Reicht „Abschnitt“ und „Folie“, oder werden einzelne Absätze innerhalb eines Abschnitts wirklich gebraucht?
5. **Tippfluss-Analyse:** Soll die Lehrkraft die Hinweise an Lernende sehen, oder nur die Lernenden selbst?
6. **Einsatzrahmen:** Welche Schulform und Altersgruppe zuerst (Oberstufe, Seminarfach, Hochschule)? Das bestimmt Vorlagen, Zitierstil und den Ton der Hinweise.
