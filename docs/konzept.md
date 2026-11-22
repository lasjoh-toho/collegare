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
| Lizenz **AGPL-3.0** | Gilt nur für den Office-Teil `web/`. Der Collegare-Kern (Server, Projektoberfläche) ist ein eigenes Programm unter Jos nicht-kommerzieller Lizenz und spricht die Editoren nur per iframe und Netzwerkprotokoll an (Entscheidung 9, `LIZENZEN.md`). Autogra.fi-Code (EUPL-1.2) darf in den Kern nur übernommen werden, soweit Jo Rechteinhaber ist. |

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
- **Wissenschaftliche Ausarbeitung im Tufte-Stil:** Export direkt aus dem Strukturmodell des eigenen Editors (Entscheidungen 13 und 14): PDF über Typst mit eigener Tufte-Vorlage (Randnotizen, Randabbildungen, Literaturverzeichnis aus den Quellen in „Notizen und Quellen“), HTML im Tufte-Stil aus Collegare selbst und eine `.qmd`-Datei zum Weiterarbeiten mit Quarto. Kein Pandoc und kein Quarto auf dem Server.
- **Verteidigung:** Probelauf-Modus mit Zeitnahme je Person; Sammlung erwarteter Fragen (von der Gruppe, optional mit KI-Vorschlägen); Notizfeld der Lehrkraft während der Verteidigung, das in die Bewertung einfließt.
- Meilenstein: Abgabe der Endprodukte. Danach ist alles schreibgeschützt (außer nach Freigabe durch die Lehrkraft).

### Prozessbegleitend: Logbuch und Reflexion

- **Logbuch (Lerntagebuch), verpflichtend:** Einträge mit Datum, Tätigkeit, Zeitaufwand, genutzten Hilfsmitteln und Reflexion. Fotos handschriftlicher Notizen lassen sich anhängen (mit Texterkennung).
- **KI-Transparenz:** Eintragstyp „KI genutzt“ mit Werkzeug, Prompt, Ergebnis (Text oder Datei) und Verwendung. Innerhalb von Collegare genutzte KI erzeugt diesen Eintrag automatisch.
- **Konsolidierung:** Am Ende erstellt Collegare ein Prozess-Logbuch je Person und Gruppe (PDF), das Logbuch, Meilensteine, Einfüge-Erklärungen, Reviews und Antworten zusammenführt.
- Die Lehrkraft kann Reflexionsimpulse je Phase vorgeben.

### Projekt-Einstellungen

Jedes Projekt hat eine **Einstellungsseite** (Zahnrad an der Projektkarte und im Projektkopf). Vorlage für Aufbau und Bedienung ist die Einstellungsseite von Autogra.fi (`public/einstellungen.html`):

- oben eine **Leiste mit Voreinstellungen**, die viele Schalter auf einmal setzen. Der aktive Knopf leuchtet wie dort, statt dass ein eigener Modus-Hinweis erscheint;
- darunter **Akkordeons** je Thema; ein Akkordeon, dessen Funktion aus ist, wird grau (`.inactive`);
- **ein** Speichern-Knopf, Konfliktschutz über eine Revisionsnummer (409, wenn zwei Lehrkräfte gleichzeitig ändern);
- **Einstellungen exportieren/importieren** als JSON-Datei, damit eine Lehrkraft ihr Projekt im nächsten Jahr oder an Kolleginnen und Kollegen weitergeben kann;
- nichts wird beim Start des Projekts gesperrt (wie in Autogra.fi entschieden). Änderungen während des Projekts stehen im Prüfprotokoll; was Lernende schon erstellt haben, bleibt erhalten, wenn ein Dokumenttyp später abgeschaltet wird (nur noch lesbar).

Voreinstellungen (Vorschlag): **Gruppenreferat**, **Seminararbeit in Gruppen**, **Facharbeit (einzeln)**, **Präsentationsprüfung** (prüfungsnah: keine KI-Hilfe, Einfüge-Protokoll mit Erklärpflicht, Phasen mit festen Terminen).

Die Akkordeons:

| Akkordeon | Einstellungen |
|---|---|
| **Projekt** | Titel, Leitfrage bzw. Aufgabenstellung (für Lernende sichtbar), Fach (für KI-Vorlagen und Dokumentvorlagen), Zeitraum, Gruppen- oder Einzelbetrieb |
| **Gruppenbildung** | Wer bildet Gruppen: *Lehrkraft* (Standard), *Lernende wählen selbst* (Wahlmodus: Lernende ziehen sich in eine Säule; Mindest- und Höchstzahl je Gruppe, Schluss-Termin, danach legt die Lehrkraft fest) oder *Lernende dürfen auch neue Gruppen anlegen*. Lernende dürfen das Thema ihrer Gruppe setzen (ja/nein). Rollenliste zur Auswahl (z. B. Zeitwächter:in, Quellenverantwortliche:r, Layout) oder freie Rollen. Gültigkeit der Zugangscodes |
| **Phasen** | Je Phase *an*, *zeitgesteuert* (von/bis) oder *aus*, wie die Schritte in Autogra.fi; Zieltermin und Meilensteine (z. B. Mindestzahl Quellen); Reflexionsimpulse je Phase |
| **Dokumente und Dateien** | **Welche Dokumenttypen Lernende anlegen dürfen** (Haken je Typ, siehe unten); **welche Dateitypen importiert werden dürfen**; welche Exportformate es gibt; Dokumentvorlagen (Folien, Handout, Methodik-Abschnitt) aus der Vorlagenbibliothek; Höchstgröße je Datei und Speicher je Gruppe |
| **Formeln** | Formeleditor an/aus; Lernende dürfen **umformen** bzw. **rechnen** (je ein Schalter, Standard aus, wie `formulatransform`/`formulacalc` in mod_pinnwand) |
| **Zusammenarbeit** | „Fertig“-Sperre an/aus; wer eine Sperre aufheben darf (nur Lehrkraft / Gruppe mit Zustimmung der Person); Peer-Review (innerhalb oder zwischen Gruppen, anonym oder offen, Leitfragen) |
| **Protokoll** | Einfüge-Protokoll: ab wie vielen Zeichen, Erklärung verlangen ja/nein; Tippfluss-Hinweise (nur sichtbar, wenn die Administration es zulässt, siehe 10.5); Logbuch verpflichtend ja/nein, Mindestzahl Einträge |
| **KI** | KI-Feedback für Lernende an/aus, Grenze je Person und Tag, Leitplanken (Systemanweisung, für Lernende unsichtbar) mit Fach-Standard aus der Seite „KI-Vorlagen“ wie in Autogra.fi; Erwartungshorizont an die KI geben ja/nein |
| **Bewertung** | Kategorien mit Gewichtung, Notensystem (Punkte, Noten, Notenpunkte 0–15 wie in Autogra.fi), Zwischenfeedback je Meilenstein, Übertragung an Moodle (AGS) |

**Rahmen der Administration.** Auf der Verwaltungsseite der Instanz legt die Administration fest, was Lehrkräfte überhaupt einstellen können: erlaubte Dokument- und Dateitypen, Höchstgrößen, ob KI verfügbar ist, Rahmen für Tippfluss-Hinweise, ob das offene Office ohne Anmeldung angeboten wird (7.10). Was der Rahmen nicht zulässt, erscheint in der Projekt-Einstellung grau mit dem Hinweis „von der Administration abgeschaltet“.

**Dokumenttypen für Lernende** (Haken je Projekt, Standard fett):

| Typ | Editor | Hinweis |
|---|---|---|
| **Abschnitt (Text)** | OnlyOffice-Texteditor, DOCX | Grundlage der Ausarbeitung, entsteht aus der Gliederung |
| **Präsentation** | OnlyOffice-Präsentationseditor, PPTX | Folien einer Person zugeordnet; Export auch als HTML (siehe unten) |
| **Handout** | Texteditor mit Layout-Vorlage | 1–2 Seiten |
| Tabelle | OnlyOffice-Tabelleneditor, XLSX | für Messreihen, Umfragen, Auswertungen |
| **Mindmap, Notizen, Logbuch** | Collegare selbst (brausa-Gestaltung) | immer da, solange die Phase aktiv ist |
| Formel | Formeleditor (siehe unten) | in Karten, Notizen und Dokumenten |
| PDF ansehen und kommentieren | OnlyOffice-PDF-Editor | für Quellen; kein eigener Text |

**Import.** Die Lehrkraft wählt aus: Textdokumente (DOCX, ODT, RTF, TXT, Markdown), Präsentationen (PPTX, ODP, PPT), Tabellen (XLSX, ODS, CSV), PDF, Bilder (JPG, PNG, HEIC vom Handy), Literatur (BibTeX, RIS). Umgewandelt wird mit x2t im Browser bzw. nativ auf dem Server. Ein **Import gilt wie ein großes Einfügen**: Er steht mit Dateiname, Größe und Prüfsumme im Einfüge-Protokoll, und bei eingeschalteter Erklärpflicht fragt Collegare nach der Herkunft. Importe der Lehrkraft (Vorlagen, Material) gelten als interne Herkunft.

**Vorlagenbibliothek.** Dokumentvorlagen (Folienmaster, Handout, Methodik-Abschnitt, Deckblatt), Einstellungs-Voreinstellungen und Rollenlisten liegen in einer Bibliothek mit drei Ebenen wie die KI-Vorlagen in Autogra.fi: mitgeliefert, von der Schule (Administration oder Fachschaft), von der Lehrkraft. Eine Lehrkraft kann ein Projekt als Vorlage speichern.

### Formeleditor

Vorlage ist der Formeleditor aus mod_pinnwand (`js/formeleditor/`): LaTeX als gespeicherte Form, Darstellung mit KaTeX (lokal ausgeliefert, kein CDN), Menüband mit Reitern nach Thema (Aufbau, Analysis, Symbole …), Vorschau, verständliche Fehlertexte, Rückgängig/Wiederholen, Menüs „Umformen“ und „Rechnen“, die die Lehrkraft für Lernende freischaltet. Die Logik (`formeleditor-logik.js`) läuft ohne DOM, also auch auf dem Server zum Prüfen.

Einsatz in Collegare:

- in Mindmap-Karten, Notizen, Logbuch und Kommentaren direkt (KaTeX-Darstellung);
- in OnlyOffice-Dokumenten über einen Knopf „Formel“ in der Collegare-Leiste: Der Editor öffnet sich als Dialog in der Projektoberfläche (nicht im Office-iframe) und fügt die Formel per `postMessage` als **OnlyOffice-Gleichung** ein (der Editor nimmt LaTeX entgegen und wandelt in OMML um; im Spike zu prüfen). Rückfall: als Bild (SVG) mit dem LaTeX-Text als Alternativtext, damit nichts verloren geht;
- in den Komponenten wird die Bedienung übernommen, nicht neu erfunden (Regel aus CLAUDE.md: übernommene Teile behalten ihre Bedienung).

### Präsentation als HTML (Bento)

Präsentationen lassen sich zusätzlich als **eine einzige HTML-Datei** exportieren, nach dem Vorbild von mod_bento: `bentoconvert.js` wandelt PPTX (und altes PPT) im Browser in ein Bento-Deck, das in die Bento-Datei (`bento-shell.html`, MIT-Lizenz) eingesetzt wird. Erhalten bleiben laut mod_bento: Farben und Schriften mit Master-Vererbung, Hintergründe, Klick-Animationen als Aufdeck-Schritte, Übergänge einschließlich Morph, Sprechernotizen, Diagramme, Tabellen, Bilder mit Alternativtext.

Nutzen:

- Die Gruppe gibt ihre Präsentation als Datei ab, die in jedem Browser ohne Office läuft und weiter bearbeitbar bleibt („die Datei ist die Software“);
- der **Verteidigungsmodus** (Phase 4) spielt das Deck im Bento-Präsentationsmodus (`#present`) und legt Zeitnahme je Person und Fragenliste daneben;
- im Moodle-Betrieb kann das Deck als Endprodukt archiviert werden (7.9) oder als mod_bento-Aktivität weiterleben.

Der Export läuft im Browser (wie in mod_bento), damit der Server dafür nichts installieren muss; er steht in der Einstellung „Exportformate“.

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
- **Folien** (und nur bei Bedarf Absätze, siehe Entscheidung 10.4) nutzen das Sperrprotokoll von OnlyOffice: Ein Client muss vor dem Bearbeiten eines Blocks (Absatz, Folie) `getLock` anfragen. Der Server verweigert die Sperre für fertige Blöcke, und der Editor erlaubt dann keine Bearbeitung. Zusätzlich prüft der Server, ob eingehende Änderungen nur Blöcke betreffen, für die der Absender eine Sperre hält (im Spike zu klären, wie zuverlässig das am Änderungsformat erkennbar ist).
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
- Folge: ein freundlicher Hinweis an die Person: Quelle notieren oder Vorfassung hochladen. Ob die Lehrkraft sieht, dass ein Hinweis kam und wie er beantwortet wurde, legt die Administration als Rahmen fest und die Lehrkraft innerhalb dieses Rahmens je Projekt (Entscheidung 10.5). Eine Punktzahl gibt es nie.
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
Browser
 ├─ Projektoberfläche (client/, Kern): Kanban, Mindmap, Notizen, Gliederung, Quellen, Logbuch, Bewertung
 ├─ OnlyOffice-Editoren (web/, AGPL, Export aus office-website) im iframe, nur per postMessage angesprochen
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

### 7.9 Moodle als Speicherort (Option im Moodle-Betrieb)

Standard ist: Collegare speichert selbst (Abschnitt 7.5). Im Moodle-Betrieb kann die Schule zusätzlich zwei Optionen einschalten (Wunsch Jo, 1. November 2026). Beide sind **nicht** Standard.

**a) Archiv in Moodle.** Bei Endabgabe oder Freigabe legt Collegare die Endprodukte (Ausarbeitung, Folien, Handout als PDF bzw. DOCX/PPTX, Prozess-Logbuch als PDF) in Moodle ab, als Abgabe in einer Moodle-Aufgabe je Person oder Gruppe. Nach Kursende kann Collegare seine Arbeitsdaten löschen; Aufbewahrung und Löschung regelt dann Moodle.

**b) Ruhespeicher in Moodle („Auslagern bei Inaktivität“).** Ist in einem Projekt bzw. einer Gruppe **x Minuten** niemand mehr verbunden (einstellbar, z. B. 30 min), packt Collegare den gesamten Stand in ein Paket und legt es in Moodle ab. Beim nächsten Start aus Moodle holt Collegare das Paket zurück und stellt den Stand wieder her. Auf dem Collegare-Server liegen Daten dann nur, solange jemand arbeitet.

| Baustein | Umsetzung |
|---|---|
| Inhalt des Pakets | Fassung jedes Dokuments (DOCX/PPTX, per nativem `x2t` erzeugt) **plus** Änderungsverlauf seit Projektbeginn (für Zeitleiste und Autorschaft), Mindmap/Kanban/Notizen als Yjs-Zustand, Quellen, Logbuch, Prozess-Ereignisse, Bewertungsentwürfe, Fotos; dazu ein Manifest mit Prüfsummen und dem letzten Hash des Prüfprotokolls |
| Format | ein komprimiertes Archiv je Gruppe, signiert mit dem Schlüssel des Werkzeugs, damit eine Manipulation in Moodle beim Zurückladen auffällt |
| Ablage in Moodle | LTI hat keinen Speicherdienst. Nötig ist ein kleines Moodle-Plugin (Erweiterung von `mod_securelink_QR` oder eigenes `local_collegare`), das Pakete im Dateibereich der Aktivität ablegt und über einen Webservice mit Token je Plattform annimmt und ausliefert. Die Moodle-Sicherung erfasst die Pakete dann automatisch |
| Sicher auslagern | erst hochladen, dann in Moodle die Prüfsumme bestätigen lassen, **erst danach** lokal löschen. Schlägt das fehl (Moodle nicht erreichbar), bleibt der Stand in Collegare und der nächste Versuch folgt später |
| Zurückladen | beim LTI-Start, wenn der Stand nicht lokal liegt: Paket holen, Signatur und Prüfsummen prüfen, wiederherstellen. Die Person sieht kurz „Arbeitsstand wird aus Moodle geladen“ (geschätzt wenige Sekunden, im Test zu messen) |
| Gleichzeitigkeit | ausgelagert wird nur, wenn niemand der Gruppe verbunden ist; ein Start während des Auslagerns wartet, bis es fertig ist |
| Größe | Fotos und lange Änderungsverläufe machen Pakete groß; Änderungen werden nach jeder Fassung zusammengefasst, Fotos nur einmal übertragen (inhaltsadressiert). Upload-Grenze der Moodle-Instanz beachten |
| Grenzen | im Einzelbetrieb ohne Moodle nicht verfügbar; die Lehrkraft-Übersicht über ausgelagerte Gruppen braucht das Zurückladen (oder eine kleine Zusammenfassung, die lokal bleibt: Fortschritt je Phase, ohne Inhalte) |

**Neutrale Ablage-Schnittstelle (Hinweis Jo).** Die Ablage wird nicht fest an Moodle gebunden, sondern als kleine, eigene Schnittstelle beschrieben, die jede Umgebung anbieten kann, in die Collegare als externes Werkzeug eingebettet ist: Moodle (über das Plugin), der Autogra.fi-Prüfungsrahmen oder eine andere Lernplattform.

- Drei Aufrufe: Paket ablegen (`PUT`, liefert Prüfsumme und Version), Paket holen (`GET`), Ablage bestätigen bzw. alte Versionen freigeben.
- Die Umgebung teilt Collegare beim Start mit, wo ihre Ablage liegt: im LTI-Start als Custom-Parameter (z. B. `collegare_storage_url`), das Zugriffsrecht holt Collegare mit seinem LTI-Schlüssel per OAuth2 (wie bei AGS/NRPS). So braucht es keine Zugangsdaten in der Konfiguration.
- Collegare selbst spricht nur diese Schnittstelle; ein Moodle-Plugin, Autogra.fi oder ein anderer Dienst setzen sie jeweils um. Fehlt sie, speichert Collegare wie üblich selbst.

**Nutzen für den Prüfungsbetrieb (Autogra.fi-Prüfungsrahmen).** Hilfreich, mit zwei Anpassungen:

- In Prüfungen gibt es kaum Inaktivität. Statt nur bei Inaktivität sichert Collegare deshalb zusätzlich **in festen Abständen** (z. B. alle 5 Minuten) und bei der Abgabe einen Stand nach Moodle. Fällt der Collegare-Server während der Prüfung aus, liegt der letzte Stand in Moodle und kann auf einem anderen Server weiterlaufen.
- Die Abgabe in Moodle ist dann der **maßgebliche Nachweis** (Zeitpunkt, Prüfsumme, Prüfprotokoll-Hash), unabhängig vom Werkzeug. Das passt zur Forderung nach manipulationssicheren Protokollen und zu getrennten Aufbewahrungsfristen.
- Zu klären: Netzlast, wenn eine ganze Prüfungsgruppe gleichzeitig sichert (Abstände staffeln), und ob Moodle in der Prüfungsumgebung erreichbar ist (abgesicherter Modus, Prüfungsbrowser).

### 7.10 Lokaler Modus: der eigene Rechner als Speicherort (Option)

Für Nutzung ohne Anmeldung (Frage Jo, 1. November 2026). office-website ist bereits „local-first“; darauf baut der Modus auf.

| Fall | Umsetzung | Grenze |
|---|---|---|
| **Einzelarbeit** | alles im Browser: IndexedDB oder ein gewählter Ordner (File System Access API, Chrome/Edge); in Safari/Firefox als Projektdatei `.collegare` zum Speichern und Öffnen; in der späteren Desktop-App (7.8) ein normaler Ordner. Kein Konto nötig | geht verloren, wenn der Browser-Speicher gelöscht wird; daher regelmäßig „Projektdatei sichern“ anbieten |
| **Gruppenarbeit** | Beitritt per Code ohne Konto; der Collegare-Server **leitet Änderungen nur weiter und speichert sie nicht**. Jeder Rechner hält eine vollständige Kopie. Mindmap, Notizen, Kanban (Yjs) führen Stände auch nach Offline-Phasen zusammen | Die Office-Editoren brauchen eine zentrale Reihenfolge der Änderungen: Gleichzeitig arbeiten geht nur, solange alle verbunden sind. Wer offline schreibt, gleicht beim nächsten Treffen über die Projektdatei ab (Abschnitt für Abschnitt) |
| **Abgabe und Bewertung** | Die Lehrkraft sieht nur, was abgegeben wird: Projektdatei oder Endprodukte per Upload, QR-Kopplung oder in Moodle (7.9) | Laufende Begleitung, Zwischenfeedback und Zeitleiste für die Lehrkraft gibt es erst ab Abgabe |

**Nachvollziehbarkeit trotz lokaler Daten:** Lokale Dateien lassen sich verändern. Damit Logbuch, Einfüge-Protokoll und Zeitleiste trotzdem belastbar bleiben, schickt der Browser für jedes Änderungspaket nur eine **Prüfsumme** an den Server, der sie mit Zeitstempel signiert zurückgibt (Quittung, keine Inhalte). Bei der Abgabe prüft Collegare die Kette der Quittungen; Lücken oder Abweichungen werden angezeigt, nicht bewertet.

**Offenes Office als Einstieg (Werbewirkung, Jo):** Die Startseite bietet ohne Anmeldung „Einfach loslegen“: neues Dokument, neue Präsentation, Tabelle oder eine Datei öffnen, alles lokal im Browser wie heute bei office-website. Daneben führen „Mit meiner Gruppe arbeiten“ (Code oder Anmeldung) und „Für Lehrkräfte“ in die Projektfunktionen. So lernen Schulen das Werkzeug ohne Hürde kennen; abschaltbar je Instanz.

**Nicht geeignet für Prüfungen:** Dort braucht es eine Anmeldung und einen Speicher außerhalb des Schülergeräts (Collegare-Server oder Ablage der Umgebung, 7.9).

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
| **Gemeinsame Anmeldung** | Beide Werkzeuge sind eigene LTI-Tools in Moodle; im Einzelbetrieb stellt Collegare die Konten aus (Abschnitt 8c). |

## 8a. Module: Werkzeuge in Collegare einbinden

Stand: 9. November 2026, Wunsch von Jo. Collegare soll eine übergreifende Plattform werden, in die Teile von
Autogra.fi (z. B. Notizen scannen und überarbeiten) und andere Werkzeuge (z. B. GeoGebra für Funktionen) als
**Module** eingebunden werden. Dieser Abschnitt legt die Anforderungen fest, **bevor** das erste Modul gebaut wird,
damit heutige Entscheidungen das später nicht verbauen.

### 8a.1 Begriffe

| Begriff | Bedeutung |
|---|---|
| **Modul** | ein Werkzeug mit eigener Oberfläche oder ein Dienst ohne Oberfläche, das Collegare einbindet |
| **Produkt** (Artefakt) | was in einem Modul entsteht: Textabschnitt, Folie, Mindmap, Notiz, GeoGebra-Konstruktion, gescannte Seite |
| **Modulbeschreibung** (Manifest) | Datei, die ein Modul beschreibt: Name, Symbol, Adresse, Produktarten, Fähigkeiten, Rechte, Lizenz, Datenfluss |
| **Werkzeug-Kachel** | Kachel der Übersicht (gestaltung.md 7), die ein Modul öffnet |

Die heutigen Oberflächen (Kanban, Mindmap, Office-Editoren, Notizen und Quellen) werden **selbst als Module
beschrieben**. So gibt es keinen Sonderweg für eingebaute Teile, und die Kachelliste (`client/lib/phases.ts`,
`TILES`) wird später aus den Modulbeschreibungen erzeugt statt von Hand gepflegt.

### 8a.2 Drei Arten der Einbindung

| Art | Wie | Beispiele |
|---|---|---|
| **Eingebettet** | eigene Seite im iframe, Austausch nur über ein festes Nachrichtenprotokoll (`postMessage`, 8a.4) | Office-Editoren (heute schon so), GeoGebra, Scannen und Überarbeiten aus Autogra.fi |
| **LTI 1.3** | Collegare tritt gegenüber dem Werkzeug als Plattform auf (wie Moodle) | fertige Lernwerkzeuge mit LTI |
| **Dienst** | Server-Schnittstelle ohne Oberfläche, mit Dienst-Token | Texterkennung von Autogra.fi (Abschnitt 8), Sprachmodell, Export |

Eingebettet ist der Standard; LTI kommt dazu, wenn ein gewünschtes Werkzeug nur LTI kann.

### 8a.3 Anforderungen an jedes Modul

1. **Collegare besitzt die Daten.** Der maßgebliche Stand jedes Produkts liegt in Collegare (versioniert, mit
   Prüfprotokoll), nicht im Modul. Ein Modul, das eigene Daten halten muss (z. B. Autogra.fi mit Seitenbildern),
   liefert Collegare mindestens einen Verweis **und** einen Schnappschuss (Text, Bild oder PDF), damit Korrektur,
   Archiv (7.9) und Export ohne das Modul funktionieren.
2. **Rechte und Sperren setzt Collegare durch.** Das Modul bekommt beim Start „lesen“ oder „schreiben“ und hält sich
   daran; Speichern prüft der Collegare-Server trotzdem (Fertig-Sperre 5.2, Phasen, Rollen). Ein Modul greift nie
   direkt auf die Datenbank zu.
3. **Einheitliche Zustände.** Jedes Produkt hat die Zustände aus gestaltung.md 2 (fehlt, Entwurf, freigegeben,
   fertig). „Fertig melden“ und „Wieder öffnen“ bietet Collegare an, nicht das Modul.
4. **Leseansicht für die Korrektur.** Jedes Modul kann ein Produkt nur anzeigen (ohne Bearbeiten) und möglichst als
   PDF oder Bild ausgeben, für Korrektur, Archiv und Abgabe an Autogra.fi.
5. **Protokoll.** Einfügen und Importe meldet das Modul an Collegare (Einfüge-Protokoll 6.1); Collegare schreibt sie
   ins Prüfprotokoll.
6. **Gestaltung.** Das Modul übernimmt Tag/Nacht und die neutralen Farbnamen (gestaltung.md 8) und baut keine eigene
   Leiste über sich (wie bei OnlyOffice, gestaltung.md 5). Inhalte behalten ihre eigenen Farben.
7. **Handy.** Die Modulbeschreibung sagt, ob das Modul am Handy nutzbar ist; sonst zeigt die Kachel dort einen
   Hinweis statt eines kaputten Werkzeugs.
8. **Datenschutz.** Die Modulbeschreibung sagt, wohin Daten fließen (eigener Server, fremder Server). Module auf
   fremden Servern schaltet nur die Administration frei, nach Bestätigung. Namen gehen standardmäßig **nicht** an
   Module, nur eine Kennung je Person und Projekt; Namen nur, wenn das Modul sie braucht und die Administration es
   erlaubt. Keine Daten an die KI ohne die Regeln aus Abschnitt 6.7.
9. **Lizenz getrennt.** Ein Modul ist ein eigener Teil mit eigener Lizenz (wie `web/`). Kein Code wird zwischen Kern
   und Modul kopiert oder importiert; nur Protokoll und Dienstschnittstelle verbinden sie (`LIZENZEN.md`).
10. **Versionen.** Modulbeschreibung und Protokoll tragen eine Versionsnummer. Ein Modul muss ältere Stände seiner
    Produkte lesen können (oder sie selbst umwandeln); Collegare speichert die Version mit jedem Stand.
11. **Freigabe in zwei Stufen.** Die Administration erlaubt Module im Rahmen (wie Dokumentarten heute); die Lehrkraft
    wählt in den Projekt-Einstellungen, welche Module in welcher Phase zur Verfügung stehen.
12. **Ausfall.** Ist ein Modul nicht erreichbar, bleibt Collegare bedienbar; die Kachel zeigt den Fehler, und der
    letzte Schnappschuss bleibt lesbar.

### 8a.4 Nachrichtenprotokoll für eingebettete Module (Entwurf `collegare/1`)

| Richtung | Nachricht | Inhalt |
|---|---|---|
| Collegare → Modul | `init` | Protokollversion, Produkt-ID und -art, Modus lesen/schreiben, Sprache, Tag/Nacht, Kennung der Person, kurzlebiges Token nur für dieses Produkt, gespeicherter Stand |
| Modul → Collegare | `ready` | Modulversion, Fähigkeiten |
| Modul → Collegare | `save` | neuer Stand (JSON oder Datei), optional Schnappschuss |
| Collegare → Modul | `saved` / `rejected` | Versionsnummer bzw. Grund (gesperrt, Phase beendet, veraltet) |
| Collegare → Modul | `mode` | Wechsel lesen/schreiben (z. B. nach „Fertig melden“) |
| Modul → Collegare | `paste` | Länge und Art des Eingefügten (6.1) |
| Collegare → Modul | `theme` | Tag/Nacht gewechselt |
| Modul → Collegare | `export` | PDF oder Bild für Korrektur und Archiv |
| beide | `error` | Fehler mit Text für die Oberfläche |

Collegare prüft bei jeder Nachricht den Absender (Herkunft aus der Modulbeschreibung). Das Token erlaubt nur
Lesen/Schreiben dieses einen Produkts über `/api/modules/…`; große Dateien gehen über diese Schnittstelle, nicht über
`postMessage`.

### 8a.5 Was das für heutige Entscheidungen heißt

- **Datenmodell:** Produkte bekommen eine gemeinsame Tabelle (Projekt, Bereich/Gruppe, Modul, Produktart,
  zuständige Person, Zustand, Version) mit Ständen in einer eigenen Tabelle. Keine modul-eigenen Spalten in den
  Kerntabellen. Die heutigen Tabellen für Mindmaps und Dokumente werden bei Gelegenheit auf diese Form gebracht.
- **Phasen verweisen auf Modulkacheln**, nicht auf fest eingebaute Seiten.
- **Korrektur** (gestaltung.md 4) listet Produkte über die gemeinsame Tabelle, damit neue Module ohne Umbau darin
  erscheinen.
- **IDs bleiben stabil** und werden nie wiederverwendet, damit Verweise aus Modulen und Moodle gültig bleiben.

### 8a.6 Erste Module (Vorschlag)

1. **Notiz scannen (Autogra.fi):** In „Notizen und Quellen“ öffnet „Notiz scannen“ Scanner und QR-Kopplung von
   Autogra.fi; die Texterkennung läuft über den Dienst aus Abschnitt 8, Überarbeiten im Editor von Autogra.fi.
   Zurück kommt eine Notiz mit Seitenbild und Text. Beide Apps gehören Jo, daher der einfachste erste Fall, an dem
   sich das Protokoll bewähren muss.
2. **GeoGebra:** Konstruktion oder Funktionsgraph als Produkt, Stand als GeoGebra-Datei in Collegare. Vorher klären:
   Lizenz (für Schulen kostenlos, aber nicht frei; Selbst-Hosten erlaubt?) und Datenschutz (Laden von fremden
   Servern vermeiden, möglichst eigene Kopie der Dateien).

## 8b. Mehrere Aufgaben gleichzeitig verfolgen (Lehrkräfte)

Wunsch von Jo (9. November 2026): Eine Lehrkraft soll ihre verschiedenen Aufgaben gleichzeitig im Blick behalten,
später über beide Apps hinweg.

- **Portal als Startpunkt:** Das Portal (gleicher Aufbau wie in Autogra.fi, gestaltung.md 3) zeigt alle Aufgaben
  der Lehrkraft, Collegare-Projekte und später Autogra.fi-Aufgaben in **einer** Liste, mit Klasse, Phase bzw.
  Schritt, Termin und Zählern („3 neue Fertig-Meldungen“, „5 Abgaben ohne Korrektur“, „2 Fragen offen“).
- **Was ist neu?** Eine Spalte bzw. Ansicht „Neu seit dem letzten Besuch“ über alle Aufgaben: Fertig-Meldungen,
  Abgaben, Fragen im Notiz-Thread, Gruppen ohne Fortschritt, abgelaufene Phasen. Ein Klick führt direkt an die Stelle.
- **Filter** nach Klasse, App, Zustand („braucht mich“, „läuft“, „abgeschlossen“); die Wahl bleibt gespeichert.
- **Wechseln ohne Umweg:** In Korrektur und Projekt lässt sich über das Seitenmenü zur nächsten Aufgabe springen, die
  Aufmerksamkeit braucht.
- **Technisch:** Jede App bietet eine kleine Dienstschnittstelle „Aufgaben-Übersicht“ (Liste mit Zählern und
  Ereignissen seit Zeitpunkt X, je Lehrkraft). Das gemeinsame Portal fragt beide ab; ist nur eine App installiert,
  arbeitet es mit dieser allein (gestaltung.md 3). Zähler werden serverseitig berechnet, nicht im Browser.
- **Benachrichtigungen** (später, abschaltbar): tägliche Zusammenfassung statt Einzelmeldungen.

---

## 8c. Gemeinsame Konten: Collegare als Kontodienst

Collegare entspricht im Aufbau der Ausschreibung; Autogra.fi kommt als Zusatz dazu. Deshalb stellt **Collegare die
Konten aus**, wenn beide auf einem Server laufen (Entscheidung 12). Grundlage ist Standard-OpenID-Connect, damit
dieselbe Kopplung auch mit einem Schul-Login (IServ, Hamburger Dienst) funktioniert.

### 8c.1 Betriebsarten

| Betrieb | Anmeldung |
|---|---|
| Start aus Moodle | Beide Werkzeuge sind eigene LTI-Tools; Moodle liefert dieselbe Personenkennung, nichts weiter nötig. |
| Beide auf dem Schulserver | Autogra.fi zeigt „Mit Collegare anmelden“; Kürzel, Passwort, Lehrende und Klassen werden nur in Collegare verwaltet. |
| Schul-Login vorhanden | Collegare und Autogra.fi melden sich beide dort an; Collegare kann den Schul-Login zusätzlich weiterreichen. |
| Eine App allein | Eigene Konten wie bisher. |

### 8c.2 Anforderungen an Collegare

1. **OpenID-Provider:** Discovery (`/.well-known/openid-configuration`), JWKS, Autorisierung mit PKCE, Token- und
   Userinfo-Endpunkt. Clients trägt die Administration ein (zuerst Autogra.fi), keine offene Registrierung.
2. **Wenige Angaben:** `sub` (feste Kennung, nie das Kürzel), Name, Rolle (`teacher`, `admin`, `student`), Bereich.
   Keine E-Mail, keine Klassen im Token.
3. **Admin nur mit Bestätigung:** Die Rolle `admin` gilt in Autogra.fi erst nach erneuter Passworteingabe (wie
   „Administrieren …“ in Autogra.fi).
4. **Klassen über die Dienstschnittstelle** (8a), nicht über das Token: Autogra.fi holt Klassenlisten mit einem
   Dienst-Schlüssel und legt dieselben Personen an (Kennung Collegare + `sub`).
5. **Fehlende Teile nachziehen**, die Autogra.fi heute schon hat: Lehrende mit eigenem Bereich, Löschen, „Ansehen
   als“, Schutz gegen Fehlversuche, Konten verbinden (8c.3), Protokoll aller Anmeldungen.

### 8c.3 Bestehende Konten verbinden, nicht zusammenlegen

Beim ersten „Mit Collegare anmelden“ fragt Autogra.fi, ob ein vorhandenes Kürzel-Konto mit dem Collegare-Konto
verbunden werden soll (Bestätigung mit dessen Passwort). Wie bei „Konten verbinden“ in Autogra.fi (8. November 2026)
bleiben beide Konten erhalten, die Verbindung lässt sich trennen, nichts wird überschrieben.

### 8c.4 Ausfallsicherheit für Klausuren

Klausuren in Autogra.fi dürfen nicht an Collegare hängen:

- Laufende Sitzungen in Autogra.fi bleiben gültig, auch wenn Collegare nicht erreichbar ist.
- Lernende in Klausuren melden sich weiter per QR-Code oder Kurzcode direkt bei Autogra.fi an.
- Die Administration von Autogra.fi behält ein lokales Notfallkonto.
- Updates von Collegare zeigen vorher einen Hinweis, wenn in Autogra.fi gerade eine Klausur läuft (über die
  Dienstschnittstelle).

### 8c.5 Stand (11. November 2026)

Gebaut in Collegare: Discovery, `/oidc/authorize` (PKCE S256 Pflicht), `/oidc/token`, `/oidc/userinfo`,
`/oidc/jwks`; Verwaltungsseite „Angebundene Apps“ (Eintragen, neues Geheimnis, Trennen); Startseite meldet an und
springt zur App zurück; „Lehrende“ mit Projektzahl und Löschen (nur ohne laufende Projekte). Offen: Autogra.fi als
Client einrichten, Konten verbinden (8c.3), Klassenlisten über die Dienstschnittstelle.

## 8d. Karten durch alle Phasen und die Pinnwand (13. November 2026)

Wünsche von Jo vom 13. November 2026, als Plan vor dem Bauen.

### 8d.1 Übernehmen ist ein aktiver Schritt, Verteilen ist freiwillig

Karten der Mindmap **können** einer Person zugewiesen werden, müssen aber nicht. In die Gliederung (und damit in
Ausarbeitung und Korrektur) kommt nur, was die Gruppe **aktiv** übernimmt (Jo, 13. November 2026, statt des
zunächst gebauten Schalters „nur sammeln“): „In die Gliederung“ an Hauptast/Cluster macht ihn zum Abschnitt, an einer
Karte zum Unterpunkt; eine übernommene Karte bringt ihren Ast mit, „Ganzer Ast“ nimmt alle Karten mit. Ein
Ansichtsmodus „Hervorheben“ zeigt alles kräftig oder graut wahlweise Übernommenes bzw. noch Offenes aus. Karten ohne
zuständige Person bleiben Unterpunkte, an denen die ganze Gruppe schreiben darf.

### 8d.2 Recherche-Karten im Seiten-Thread

In der Recherche entstehen neue Karten (Notiz, Quelle mit Fundstelle, Foto, Link, Chat-Beitrag). Sie landen in
**einem** Thread je Gruppe („Notizen und Quellen“, Issue #8), der als Leiste rechts erscheint: in der Mindmap
und in der Pinnwand (dort als Post-Stream, der in mod_pinnwand schon „Warteraum“ ist). Von dort zieht man sie auf
die Fläche, an einen Knoten oder in einen Abschnitt. Eine Karte bleibt **ein** Datensatz; Mindmap und Pinnwand
verweisen nur darauf, damit eine Überarbeitung überall ankommt.

### 8d.3 Karten überarbeiten: einfacher Editor und Einfügen

- Jede Karte öffnet sich in einem **einfachen Editor** (Titel, Text mit Absätzen, Fett/Kursiv, Listen, Link,
  Quelle). Kein Office, damit es am Handy geht.
- **Kopieren und Einsetzen innerhalb des Projekts** ist immer erlaubt. Die eingesetzte Stelle merkt sich die
  Herkunft (Karte, Person, Zeit) und zeigt sie auf Wunsch als Zuschreibung.
- **Einsetzen von außen** regelt die Lehrkraft in den Einstellungen: erlauben, nach der Herkunft fragen (wie
  `pasteExplain`) oder nur bis zur Länge `pasteThreshold`. Jedes Einsetzen von außen kommt ins Einfüge-Protokoll
  (6.1).

### 8d.4 Handschriftliche Notizen mit Autogra.fi

Ist Autogra.fi verbunden (8c), bietet der Thread „Notiz scannen“: Scanner und QR-Kopplung aus Autogra.fi, Texterkennung
über den Dienst (Abschnitt 8), Überarbeiten des erkannten Texts neben dem Seitenbild. Zurück kommt eine Karte mit
Bild und Text (8a.6, erstes Modul). Voraussetzung ist die Anmeldung über Collegare in Autogra.fi (8c.5, offen).

### 8d.5 mod_pinnwand als Modul für die Präsentation

**Ja, das geht.** mod_pinnwand steht unter derselben nicht-kommerziellen Lizenz wie der Kern (Entscheidung 9) und
kann daher in `client/` mitgeliefert werden. Die Oberfläche ist ein einzelnes Skript (`js/app.js`, rund 14 000
Zeilen, ohne Build) mit impress.js für die Präsentation entlang des Roten Fadens. Mit Moodle spricht es nur über
**eine** Stelle: `callAjax(methodname, args)` an `lib/ajax/service.php` mit etwa 40 Web-Service-Methoden
(`classes/external.php`) auf sieben Tabellen und der Moodle File API.

Einbindung als eingebettetes Modul (8a.2):

1. **Eine kleine Änderung in mod_pinnwand:** `callAjax` nutzt einen von außen gesetzten Transport, falls vorhanden
   (`cfg.transport`), sonst wie bisher Moodle. So bleibt **ein** Quellstand für Moodle und Collegare.
2. Collegare liefert die Dateien von mod_pinnwand unverändert unter `/module/pinnwand/` aus (Skript holt einen
   festen Stand) und startet sie im iframe mit dem Transport `collegare/1`.
3. Collegare bildet die Web-Service-Methoden auf eigene Tabellen ab (siehe Speichern) und prüft Rechte, Phase und
   Fertig-Sperre selbst (8a.3).

**Erweiterung der Mindmap für die Präsentation:** „Pinnwand aus der Mindmap“ legt für die Gruppe ein Board an.
Hauptäste werden Rahmen, Karten werden Textfelder (Wortfelder) darin, Bilder aus dem Thread bleiben Bilder. Die
Reihenfolge der Gliederung wird der **Rote Faden**, aus dem die Pinnwand die Präsentation macht. Danach sind Mindmap
und Pinnwand getrennte Stände; „neu übernehmen“ ergänzt nur, was fehlt.

**Speichern, angepasst an Collegare:**

| heute in Moodle | in Collegare |
|---|---|
| je Aufruf ein Web-Service, sofort in die Tabelle | gleich: je Aufruf eine kleine Änderung, sofort gespeichert (kein Speichern-Knopf) |
| Tabellen `pinnwand_*` je Kursmodul und Person | ein Produkt „Pinnwand“ je Gruppe (8a.5) mit Objekten, Platzierungen, Faden, Tinte als JSON-Zeilen; Fremdschlüssel sind Produkt und Gruppe statt Kursmodul |
| Bilder in der Moodle File API | Bilder in der Datenbank wie Material und Dokumente, in mehreren Größen; Grenze aus `maxFileMb` |
| jede Person eigenes Board, Lehrkraft sieht alle | Board der Gruppe, alle der Gruppe bearbeiten gemeinsam; eigene Boards nur im Einzelmodus |
| Neuladen zeigt fremde Änderungen | Änderungen gehen per socket.io an alle, die das Board offen haben; bei gleichzeitigem Verschieben gewinnt die letzte Änderung je Objekt |
| Sicherung über Moodle-Backup | Versionen je Board (Schnappschuss je Sitzung), Archiv in Moodle über 7.9 |

### 8d.6 Reihenfolge (Vorschlag)

1. Aktives Übernehmen in die Gliederung mit „Hervorheben“ (8d.1), klein.
2. Thread „Notizen und Quellen“ mit Recherche-Karten, in der Mindmap als Leiste (8d.2).
3. Karten-Editor mit Einfüge-Regeln (8d.3).
4. Pinnwand als Modul samt Übernahme aus der Mindmap (8d.5), mit der kleinen Änderung in mod_pinnwand.
5. Notiz scannen mit Autogra.fi (8d.4), sobald die Anmeldung über Collegare steht.

## 8e. Notizen und Quellen, zweite Fassung (17. November 2026)

Wünsche von Jo vom 17. November 2026. Sie ersetzen die Rechte aus 8d.2 (dort sah jede Person alles ihrer Gruppe,
ändern durfte nur die Erstellerin). Eine Notiz bleibt **ein** Datensatz; Mindmap, Pinnwand, Folien und Ausarbeitung
verweisen nur darauf.

### 8e.1 Neue Notiz

Ein deutlich sichtbarer Knopf **„+ Neue Notiz“** steht unter den Karten. Der Thread läuft dafür wie ein Chat von alt
(oben) nach neu (unten) und springt beim Öffnen ans Ende. Der kleine „+“ in der Kopfzeile entfällt.

### 8e.2 Sichtbarkeit: Privat, Gruppe, Allgemein

Jede Notiz hat eine Sichtbarkeit, die man an der Karte mit einem Select einstellt, in dieser Reihenfolge:

| Stufe | wer sieht sie | Standard |
|---|---|---|
| **Privat** | nur die Erstellerin (und die Lehrkraft, siehe unten) | |
| **Gruppe** | die eigene Gruppe | ja |
| **Allgemein** | alle im Projekt, also auch die anderen Gruppen | |

- Die **Lehrkraft sieht alles**, auch private Notizen. Damit das für Lernende kein Geheimnis ist, heißt die Stufe im
  Select „Privat (nur ich und die Lehrkraft)“. Die Lehrkraft darf Notizen auf Privat zurückstellen (zum Beispiel einen
  Beitrag, der nicht für alle gedacht war), aber **keine private Notiz veröffentlichen**: Das entscheidet nur die
  Erstellerin.
- Ändern und Löschen: die Erstellerin und die Lehrkraft (wie bisher).

### 8e.3 Das Select in der Kopfzeile ist ein Filter

Dasselbe Select mit denselben drei Stufen steht in der Kopfzeile und filtert die Karten:

- **Lernende:** „Privat“ zeigt die eigenen privaten Notizen, „Gruppe“ alles der eigenen Gruppe, „Allgemein“ die
  Notizen, die **irgendeine** Gruppe (oder die Lehrkraft) für alle freigegeben hat. Eine neue Notiz bekommt die
  Stufe, die gerade im Filter steht.
- **Lehrkraft:** Sie wählt wie bisher die Gruppe und sieht deren **alle** Karten. Freigegebene Karten (Allgemein)
  sind **angehoben und haben einen Schatten**, private sind gestrichelt umrandet. Dazu kommt die Auswahl
  „Allgemein (alle Gruppen)“; was die Lehrkraft dort schreibt, sehen alle.
- Die Art-Knöpfe (Notizen, Quellen, Links …) bleiben als zweiter Filter darunter.

### 8e.4 Karten melden

Jede Person kann eine fremde Karte **melden** (Grund freiwillig). Danach sehen sie nur noch die Lehrkraft, die
Erstellerin und die meldende Person. Steht sie schon in Mindmap oder Pinnwand, bleibt die Karte dort stehen, zeigt
aber nur noch „gemeldet“ statt des Inhalts.

- Die **Erstellerin** sieht „Diese Karte wurde gemeldet“, aber **nicht, von wem**.
- Die **Lehrkraft** sieht, wer gemeldet hat und warum, und kann die Meldung **aufheben** (Karte wieder sichtbar) oder
  die Karte löschen bzw. auf Privat stellen.
- Meldungen kommen ins Prüfprotokoll (6.5). Eine Person kann dieselbe Karte nur einmal melden.

### 8e.5 Weitere Arten

| Art | Inhalt | Hinweis |
|---|---|---|
| Notiz, Quelle, Link | wie bisher | |
| **Bild** | Bilddatei mit Urheber, Lizenz, Ursprungsseite | vom Thread „Bilder per Drag and drop übernehmen“: Ziehen aus anderen Tabs, Einfügen, Abruf über den Server |
| **Daten** | kleine Tabelle (Kopfzeile + Zeilen), Einfügen aus Tabellenkalkulation | bis 50 × 12 Zellen; wird in Ausarbeitung und Folien zur Tabelle |
| **Video**, **Audio** | Datei (Aufnahme am Handy oder Hochladen) oder Link | erlaubt und begrenzt durch `notesAudio`, `notesVideo`, `notesMediaMb` (Projekt und Rahmen, 8g.4); Aufnahme mit `MediaRecorder` |
| **Handschrift** | Foto einer handschriftlichen Notiz plus erkannter Text | Erkennung über Autogra.fi (8d.4), solange das nicht verbunden ist: Text selbst abtippen |

Dateien liegen wie die Pinnwand-Medien unter `DATA_DIR` und kommen in `sichern` mit.

### 8e.6 Bearbeiten an Ort und Stelle

Ersetzt am 20. November 2026 das große Modal (Wunsch Jo): Doppelklick auf eine Notiz öffnet sie zum Bearbeiten in der
Liste, ein Klick daneben speichert und schließt, Esc verwirft. Siehe 8g.2.

### 8e.7 Eigene Linie: Notizen parallel zur Gliederung (U-Bahn) – ersetzt durch 8h

Jede Person kann sich ihre Notizen **in eine eigene Reihenfolge** bringen, die parallel zur Gliederung läuft. Bild
dafür ist eine **U-Bahn-Linie**, wie in der Mindmap-Ansicht „Äste“:

```
Gliederung              meine Linie
 1 Einleitung   ──────── ○  Zitat Müller
                         │  └ Bild: Karte 1850 (sichtbar)
 2 Ursachen     ──────── ○  Statistik (Daten)
                         ○  Notiz „Frage an Gruppe“
 3 Folgen       ──────── ○  …
```

- Die Linie ist **senkrecht** mit **weißen Kreisen** als Stationen. Neben jeder Station steht der Abschnitt der
  Gliederung, zu dem sie gehört; Abschnitte ohne Station bleiben als dünne Markierung stehen.
- Notizen zieht man aus dem Thread auf die Linie. Eine Station ist eine Notiz, die eigene Reihenfolge und die
  Zuordnung zum Abschnitt gehören der Person (nicht der Notiz), so kann jede Person ihre eigene Linie haben, ohne die
  anderen zu stören.
- **Karten in eine Karte ziehen:** Auf eine Station lassen sich weitere Karten ziehen, zum Beispiel Bildquellen, die
  in der Präsentation auf derselben Folie erscheinen sollen. Jede so angehängte Karte hat ein Auge zum **Ein- und
  Ausblenden** (ausgeblendet = bleibt als Beleg dabei, erscheint aber nicht in Folie bzw. Text).
- Daraus folgt später: eine Station = ein Absatz bzw. eine Folie, angehängte sichtbare Karten = Bilder, Tabellen,
  Zitate darauf, angehängte Quellen = Literatur- und Bildnachweis.

### 8e.8 Hausarbeit und Präsentation synchronisieren

Wer Ausarbeitung **und** Präsentation hat, kann beide über die Linie koppeln. Dann steht die **Linie in der Mitte**:
links die Abschnitte der Ausarbeitung, rechts die Folien. Eine Station verbindet einen Abschnitt (oder Absatz) mit
einer Folie. Angehängte Karten erscheinen auf beiden Seiten; Zusatztexte der Folien (Sprechernotizen) und der Text des
Abschnitts lassen sich nebeneinander vergleichen. Das ist auch die Antwort auf Jos Idee, Zusatztexte und Ausarbeitung
zu synchronisieren: Der Abgleich läuft über die Station, nicht über Text-Diff.

Gespeichert wird die Linie als eigenes Produkt je Person (`lines`: Stationen mit Notiz, Abschnitt, Folie, angehängten
Karten samt Sichtbarkeit). Folien und Abschnitte werden nur referenziert.

### 8e.9 Typst als Basis

Typst bleibt die **Ausgabe**, nicht die Datenbasis (Entscheidung 14). Grundlage aller Teile oben ist das
Strukturmodell in der Datenbank: Notizen mit Art und Sichtbarkeit, Linie mit Stationen, Gliederung, später der eigene
Texteditor (Entscheidung 13). Daraus erzeugt Collegare beim Export den Typst-Text:

- Quellen-Notizen werden zum Literaturverzeichnis (Typst liest das Hayagriva-/BibLaTeX-Format, Zitierstil per CSL),
  Bild-Notizen zu Abbildungen mit **automatischem Bildnachweis** aus Urheber, Lizenz und Ursprungsseite,
  Daten-Notizen zu Tabellen, Handschrift zum erkannten Text mit Bild als Randabbildung.
- Die Linie liefert die Reihenfolge, angehängte sichtbare Karten die Abbildungen und Tabellen je Abschnitt.
- Die Präsentation bleibt Bento; Typst erzeugt dazu höchstens ein **Handout** aus derselben Linie.

Typst als Bearbeitungsformat wäre falsch: Lernende sollen kein Markup schreiben, und Typst kennt weder Sichtbarkeit
noch Gruppen noch gemeinsames Bearbeiten. Als unsichtbarer Standard unter dem Editor mit „Für Fortgeschrittene“
(Quelltext ansehen, Typst-Baustein, Vorlage) passt es dagegen gut. Typst kann als WASM im Browser laufen (typst.ts),
dann braucht der Server kein zusätzliches Programm.

### 8e.10 Reihenfolge

Stand 17. November 2026: Schritte 1 bis 3 sind gebaut (Linie als Ansicht „Meine Linie“ auf der Notizen-Seite, Tabelle
`note_lines`) (Bild aus dem Thread „Bilder per Drag and drop“). Handschrift wird
noch abgetippt; „Text erkennen“ wartet auf die Verbindung zu Autogra.fi (8d.4).

1. Plus-Knopf, Sichtbarkeit mit Filter, Schatten für Freigegebenes, Melden, großes Modal (klein, sofort).
2. Arten Daten, Video, Audio, Handschrift (nach der Bild-Art aus dem Nachbar-Thread, gleiche Dateiablage).
3. Eigene Linie mit Stationen und angehängten Karten (8e.7).
4. Kopplung Ausarbeitung und Präsentation (8e.8), braucht den eigenen Texteditor oder zumindest Abschnitte als Ziel.
5. Typst-Export aus Linie, Notizen und Gliederung (8e.9).
## 8f. Zusatztexte der Folien und Ausarbeitung abgleichen (Konzept, 17. November 2026)

Idee von Jo vom 17. November 2026, hier als Konzept vor dem Bauen. Ergänzt 8e.8: Dort verbindet eine Station der
Linie einen Abschnitt mit einer Folie; hier steht, was dann mit dem Text geschieht.

### 8f.1 Ausgangslage

Jede Folie in Bento kann einen **Zusatztext** tragen (`slide.longRead`, Blöcke: Überschrift, Erklärung, Zitat,
Bildunterschrift, Glossar, Aufgabe, Quellen); im Vortrag wischt man nach oben oder klickt den Knopf unten. Die
**Ausarbeitung** besteht aus Abschnitts-Dokumenten, die aus der Gliederung entstehen (Abschnitt 4, Phase 3). Beide
erzählen dasselbe: die Folie die Kernaussage, der Zusatztext eine Lesefassung, die Ausarbeitung den ausführlichen
Text. Heute pflegt eine Gruppe beides getrennt, und die Fassungen laufen auseinander.

**Ziel:** Ein Gedanke wird einmal geschrieben und erscheint als Absatz in der Ausarbeitung und als Zusatztext hinter
der passenden Folie, ohne dass zwei Fassungen entstehen.

### 8f.2 Vorschlag

1. **Verknüpfung über die Gliederung.** Eine Folie lässt sich an einen Abschnitt oder Unterpunkt der Gliederung
   binden: über eine Station der Linie (8e.8) oder direkt im Seitenmenü von Bento (Bereich „Zusatztext“, Auswahl
   „Abschnitt der Ausarbeitung“). Beides ist dieselbe Verknüpfung. Im Deck steht sie als
   optionales Feld `slide.link = { app: 'collegare', card: '<Karten-ID>' }`; Bento ignoriert es außerhalb von Collegare
   (Formatregel „nur hinzufügen“). Umgekehrt zeigt die Ausarbeitung am Rand, welche Folie zum Abschnitt gehört.
2. **Abgeglichen wird je Absatz, nicht je Dokument.** Ein Absatz der Ausarbeitung und ein Block des Zusatztexts sind
   „gespiegelt“, wenn sie dieselbe Kennung tragen. Beim Spiegeln wählt man einzelne Absätze aus (Häkchen), denn ein
   Zusatztext ist eine Lesefassung, kein vollständiger Abschnitt. Randnotizen werden zu `<<Referenz:Wort|Erklärung>>`,
   Quellen zum Block „Quellen“ aus denselben Datensätzen wie „Notizen und Quellen“.
3. **Die Ausarbeitung führt.** Änderungen in der Ausarbeitung kommen beim nächsten Öffnen der Präsentation an
   („2 Absätze in der Ausarbeitung geändert – übernehmen?“). Ändert jemand einen gespiegelten Block im Zusatztext,
   wird er zur Abweichung (markiert). Collegare bietet dann „In die Ausarbeitung zurückschreiben“ als Vorschlag an die
   zuständige Person oder „Lösen“ (der Block wird eigenständig). Kein stilles Zusammenführen in beide Richtungen:
   Abschnitte haben Zuständige und Fertig-Sperren (Abschnitt 5), eine Folie gehört der ganzen Gruppe.
4. **Die Präsentation bleibt eine eigenständige Datei.** Gespiegelte Blöcke stehen als Kopie mit Stand im Deck, damit
   der Export ohne Collegare läuft („die Datei ist die Software“).

### 8f.3 Technik in zwei Stufen

- **Stufe 1, mit OnlyOffice möglich:** Im Zusatztext-Editor „Aus der Ausarbeitung einfügen …“: Collegare holt den
  zuletzt gespeicherten Stand des gebundenen Abschnitts als DOCX, wandelt ihn im Browser in Absätze (mammoth, wie beim
  Word-Import der Lernseiten) und merkt sich Herkunft und Stand. Ein Hinweis zeigt später, dass der Abschnitt neuer
  ist. Ohne Rückweg, weil OnlyOffice keine verlässlichen Absatz-Kennungen liefert.
- **Stufe 2, mit dem eigenen Texteditor (Entscheidung 13):** Absätze sind Yjs-Knoten mit fester Kennung. Bento bekommt
  gespiegelte Blöcke über das Host-Protokoll (`postMessage` `longread-sync`, wie `title`/`undo`) und meldet
  Abweichungen zurück. Dieselbe Verknüpfung trägt die geplante Ansicht „Hausarbeit mit Präsentation“ (Ausarbeitung
  links, Folien rechts, die Gliederung als U-Bahn-Linie in der Mitte).

### 8f.4 Offene Fragen an Jo

- Soll die Ausarbeitung führen (Vorschlag), oder darf auch der Zusatztext direkt zurückschreiben?
- Reicht Stufe 1, bis der eigene Texteditor kommt?
- Gehört zu einer Folie genau ein Abschnitt, oder darf sie mehrere Unterpunkte bündeln?

## 8g. Herkunft von Texten und Notizen, dritte Fassung (20. November 2026)

Wünsche von Jo vom 20. November 2026, gebaut am selben Tag.

### 8g.1 Arbeitsprozess: Herkunft von Texten

- Leitsatz für Lernende: „Es ist Bestandteil wissenschaftlichen Arbeitens, bei der Wiedergabe fremder Texte die Quelle
  anzugeben.“ (in der Frage nach der Herkunft, auf der Seite „Arbeitsprozess“, in den Einstellungen)
- **Jedes Einsetzen von außen wird protokolliert** (Einstellung `pasteLogAll`, Standard an). Sonst ließe sich die Grenze
  umgehen, indem man absatzweise kopiert.
- Die **erlaubte Zeichenzahl** (`pasteThreshold`) legt die Lehrkraft fest. Sie zählt **je Ziel** (Karte, Notiz) alles
  zusammen, was eine Person von außen eingesetzt hat (`GET …/einfuegen/summe`). Darüber gilt `pasteOutside`: erlauben,
  nach der Herkunft fragen oder nicht mehr einsetzen lassen.
- Jeder Eintrag kennt sein Ziel (`card:<id>`, `note:<id>`) und den ganzen Text (höchstens 50 000 Zeichen,
  Migration 0018). Die Seite ordnet die Einträge nach Ziel.
- **Texterkennung**: Einträge mit `origin` `print` (Druckschrift) oder `hand` (Handschrift) tragen das Bild als Notiz
  (`note_id`) und erscheinen mit Vermerk und Bild. Der Server hat dafür `Pastes.addOcr`; es ruft sie auf, sobald die
  Erkennung über Autogra.fi läuft (8d.4). Bis dahin gibt es keine solchen Einträge.
- Noch nicht protokolliert: Einsetzen in die Ausarbeitung (OnlyOffice, `web/`). Das braucht ein Signal aus dem Editor per
  `postMessage`; kommt mit dem Textabgleich aus 8f.

### 8g.2 Paste and Shake

„Paste and Shake“: Stücke aus mehreren Quellen einsetzen, umstellen, ein wenig umformulieren. Ein Vergleich ganzer
Absätze findet das nicht mehr. Antwort auf Jos Frage, wie wir damit umgehen:

1. **Vorbeugen**: Jedes Einsetzen steht im Protokoll, die Grenze zählt je Karte oder Notiz zusammen, die Frage nach der
   Herkunft kommt ab der Grenze. Wer korrekt zitiert, gibt die Quelle an und ist damit fertig.
2. **Sichtbar machen statt beschuldigen**: Die Lehrkraft öffnet bei einer Karte oder Notiz die **Spur im Text**
   (`GET …/einfuegen/spur`, Vergleich im Browser in `client/lib/trace.ts`). Jede Folge von drei Wörtern, die auch in
   einer eingesetzten Vorlage steht, färbt ihre Wörter in der Farbe dieser Vorlage; nur Läufe ab fünf Wörtern zählen.
   Darunter je Vorlage: Anteil am Text, wie viel der Vorlage noch drinsteckt, und „Reihenfolge umgestellt“, wenn die
   Stücke anders angeordnet sind als in der Vorlage.
3. **Grenzen**: Gut Umformuliertes ist nicht mehr zu sehen, korrekt Zitiertes ist auch gefärbt. Die Spur ist ein Anlass
   für das Gespräch, keine Bewertung (wie die Tippfluss-Hinweise, Entscheidung 10.5). Texte, die nicht über Collegare
   eingefügt wurden (abgetippt), kennt sie nicht.

### 8g.3 Notizen

- **Feld Material** oben in der Notiz: Adresse einfügen, Datei wählen oder Foto aufnehmen, oder leer lassen. Die Art
  ergibt sich daraus (Bildadresse: der Server holt das Bild; YouTube/Vimeo/Videodatei: Video-Link; sonst Link mit dem
  Seitentitel als Überschrift) und lässt sich im kleinen Menü „Art“ ändern.
- **Überschrift aus Markierung**: Wörter im Text markieren, dann „… als Überschrift“.
- **Bearbeiten** per Doppelklick an Ort und Stelle, Klick daneben speichert (8e.6). Der Stift bleibt für Touch-Geräte.
- **Auf Notizen verteilen** (nach „Auf Seiten verteilen“ in mod_bento): Ein Stück einer Webseite mit Text und Bildern,
  eingefügt oder hergezogen, wird zerlegt (`client/lib/splitPaste.ts`): Eine Notiz, je Abschnitt (Überschrift oder Bild)
  oder je Absatz; die Bildunterschrift kann Überschrift werden. Browser geben beim Kopieren die Seite nicht mit; wir
  nehmen den Link um ein Bild oder fragen nach der Ursprungsseite und lesen dann Titel, Autor und Lizenz. Der Text geht
  ins Protokoll (8g.1).
- **Quellenangabe** als Filter (Alle, Mit Quellenangabe, Quellenangabe fehlt mit Zahl) statt eines roten Hinweises
  unter jeder Notiz. Eine Angabe brauchen Quellen, Links, Bilder (Ursprungsseite und Urheber oder Lizenz), Daten und
  verlinkte Videos; eigene Notizen, Aufnahmen und Handschrift nicht.
- **Symbole** sind Linien-Symbole (`components/Icon.tsx`) statt Unicode-Zeichen.

### 8g.4 Ton und Video begrenzen

Aufnehmen und Hochladen von Ton und Video ist datenintensiv. Die Lehrkraft schaltet beides je Projekt (`notesAudio`,
`notesVideo`) und legt die Größe je Aufnahme fest (`notesMediaMb`); der Rahmen der Administration begrenzt beides. Der
Server prüft beim Hochladen. Links auf Videos gehen immer.

## 8h. Gliederung als U-Bahn-Linien, Mindmap mit Abzweigungen (20. November 2026)

Wünsche von Jo vom 20. November 2026 zu Mindmap, Gliederung und der Linie neben den Notizen. Sie ersetzen das
„Gliederung übernehmen“ aus 8d.1 und „Meine Linie“ aus 8e.7.

### 8h.1 Zwei Linien statt „Gliederung übernehmen“

- Die Gliederung ist eine **senkrechte U-Bahn-Linie** mit weißen Stationen, sofort durchgehend. Es gibt zwei Linien:
  **Präsentation (rot)** und **Ausarbeitung (blau)**. Darüber stehen zwei große Reiter, dazwischen der Schalter
  **„beides“** (zwei parallele Striche) für die Vollbild-Ansicht, in der beide Linien in der Mitte nebeneinander laufen.
- Die Lehrkraft legt in den Einstellungen (Ergebnisse) fest, ob Lernende beide Linien oder nur eine sehen
  (`outlineLines`: both, praes, ausarb). Lehrkräfte sehen immer beide.
- Die Linie steht **neben der Mindmap** (Seitenleiste, auf breiten Bildschirmen offen) und **rechts neben „Notizen und
  Quellen“**. Es ist dieselbe Linie: Was in der einen Ansicht geändert wird, erscheint sofort in der anderen.
- Der Knopf „Gliederung übernehmen“ entfällt. „In die Gliederung“ an einem Ast oder einer Idee nimmt sie in die gerade
  gezeigte Linie auf; ganze Äste und einzelne Knoten lassen sich auch aus der Mindmap **auf die Linie ziehen** (auf einen
  Punkt: Unterpunkt; ans Ende: neuer Punkt). Vorbild ist der „Rote Faden“ von mod_pinnwand, ein Faden je Gruppe.

### 8h.2 Punkte, Objekte und Schloss

- **Punkte** (Stationen) haben höchstens zwei Ebenen. Ein Punkt verweist auf eine Karte der Mindmap (Titel und
  Zuständige kommen von dort) oder ist nur in der Gliederung entstanden: dann **gestrichelt**.
- **Ausblenden** (Auge) lässt einen Punkt in der Gliederung stehen, zählt aber nicht für Ausarbeitung und Folien;
  **Entfernen** legt ihn unter „Entfernt“ ab, wo man ihn zurückholen kann. In der Mindmap erscheinen solche Karten
  **ausgegraut**.
- **Objekte** (Notizen aus dem Thread, Karten) zieht man von überall auf einen Punkt. Sie lassen sich von oben nach
  unten sortieren (an die obere Kante eines Objekts ziehen) und **ineinander legen** (auf ein Objekt ziehen), höchstens
  dreifach; dann wandern sie gemeinsam. Jedes Objekt hat ein Auge (sichtbar: erscheint auf derselben Folie bzw. im
  selben Absatz; ausgeblendet: bleibt als Beleg dabei). Gestaltung neobrutalistisch: Rand, harter Schatten, tiefere
  Ebenen mit größerem Schatten.
- **Schloss:** Sobald die Gliederung mit Objekten überarbeitet ist, erscheint ein Schloss. Gesperrt ändert sich die
  Gliederung nicht mehr, auch nicht aus der Mindmap, bis jemand aus der Gruppe oder die Lehrkraft es öffnet.
- „nur meine“ zeigt nur die Objekte, die man selbst angehängt hat. Das ist der erste Schritt zu „jede Person ordnet ihre
  Notizen für sich parallel zur Gliederung“ (siehe offen).

### 8h.3 Beide Linien synchronisieren

In der Ansicht „beides“ stehen gleiche Punkte in **derselben Zeile** und sind zwischen den Linien verbunden. Gleich
heißt: gleicher Schlüssel, also aus derselben Karte der Mindmap oder mit „in die andere Linie übernehmen“ kopiert. Die
Zeilen entstehen wie bei einem Textvergleich (längste gemeinsame Folge); Punkte, die nur eine Linie hat, stehen
dazwischen. Objekte, die in beiden Linien hängen, tragen „in beiden“. Damit ist die Kopplung von Ausarbeitung und
Präsentation (8e.8) als Ansicht da; die Kopplung von Folien und Zusatztexten in Bento (8f) baut darauf auf.

### 8h.4 Daten

Die Linien liegen in der Mindmap der Gruppe (`map.lines`) und laufen über dieselbe Operationsschlange
(`map:op` mit `{type:'lines'}`, ersetzt die ganze Gliederung; die letzte Änderung gewinnt). Der Server prüft Ebenen,
Personen und Schloss und leitet daraus `card.pick` (in der Gliederung) und `map.outline` ab (Abschnitte aus der
Ausarbeitung, ohne sie aus der Präsentation), damit Ausarbeitung, Korrektur und Pinnwand weiterarbeiten. Alte
Mindmaps bekommen beim Lesen beide Linien aus den übernommenen Ästen. Die Tabelle `note_lines` („Meine Linie“) bleibt
erhalten, wird aber nicht mehr angezeigt.

### 8h.5 U-Bahn-Mindmap (Ast-Ansicht)

- An jedem Zwischenstopp des gewählten Asts steht ein **Plus**. Es öffnet den Dialog **Abzweigung**: Eingabefeld Titel
  (Enter legt an), darunter in einer Zeile „Zwischenstopp löschen“ und „Abbrechen“; ein Klick außerhalb bricht ab.
- Eine Abzweigung am Hauptast wird eine **lockere Idee** ohne Anbindung an spätere Knoten (kein Abschnitt), sonst ein
  Geschwister im selben Ast. Der Ast beginnt am Stopp (`card.fork`).
- **Langer Druck** (450 ms) auf einen Knoten packt den **Ansatz** seines Asts; über einem Stopp eines anderen Asts
  rastet er als Abzweigung ein. (Jos Satz „Dann werden diese entweder …“ bricht ab; siehe offen.)

### 8h.6 Karten-Ansicht

- **Neobrutalistisch**: kräftiger Rand, sichtbare harte Schatten; Cluster liegen am höchsten (größter Schatten), Karten
  darin tiefer, Karten in Karten noch tiefer. Farben wie die Äste der Ast-Ansicht.
- **Direkt schreiben**: Doppelklick auf den Kopf ändert den Titel, auf den Text schreibt man darunter; Enter im Titel
  springt in den Text. Längeres Einsetzen von außen läuft über den Karten-Editor, damit die Einfüge-Regeln greifen.
- **Karten in Karten**: Eine Karte auf eine andere gezogen liegt darunter in ihr (`card.under`, wie in der Ast-Ansicht)
  und wandert mit. An die obere Kante gezogen wird sie davor einsortiert; „Herausnehmen“ löst sie. Cluster ordnet
  „Ordnen“ von oben nach unten zu einer Reihe. Wächst eine Karte, rücken die Karten darunter nach.
- **Text ausblenden** je Karte (`card.hideText`) oder für die ganze Mindmap („Text aus“, je Gerät).

### 8h.7 Offen

- Jos Satz zu den Ansätzen bricht ab („Dann werde diese Entweder“): was nach dem Packen passieren soll.
- Zuständigkeiten aus der Gruppenarbeit (Rollen) im Seitenmenü: bisher nur die zuständige Person je Punkt.
- Jede Person ordnet ihre Notizen in eigenen Clustern parallel zur Gliederung (eigene Ebene neben der Linie).
- Punkte, die nur in der Gliederung stehen, werden noch keine Dokumente der Ausarbeitung.
- Folien in Bento an Punkte koppeln (8f), Zusatztexte über gemeinsame Objekte.
- Gleichzeitiges Bearbeiten der Gliederung: die letzte Änderung gewinnt (später einzelne Operationen).

### 8h.8 Zweite Runde (21. November 2026)

- **Gliederung:** Alle Stationen sitzen genau auf der Mitte der Linie. Vier Ebenen: großer Kreis (Abschnitt), kleiner
  Kreis, Punkt in der Linie, kurzer Strich (etwa 1 mm) zur Beschriftung hin; Ein- und Ausrücken per Knopf. Beschriftungen
  näher an der Linie, Objekte flach ohne Schatten. In „beides“ liegen die Linien weiter auseinander. Notizen, Karten und
  Äste lassen sich direkt auf die Linie legen; an der Stelle entsteht ein neuer Kreis (Geisterkreis zeigt sie an).
- **Seite der Gliederung:** rechts in den Schritten davor (Mindmap, Cluster, Notizen), links beim Schreiben
  (Ausarbeitung); beim Wechsel gleitet die Seite hinüber. Auf der Schreibseite ist die Linie „Ausarbeitung“ vorgewählt.
- **Schnittstelle zum Schreibeditor (8i):** `map.outline.sections` bleibt {id, title, cards, owners}; neu ist je
  Abschnitt `subs: {id, title, level}[]` mit den Ebenen 2 bis 4. Punkte ohne Karte sind Abschnitte mit der Punkt-id.
  Der Schreibeditor gleicht selbst ab, sobald sich `map.outline.at` ändert, und trägt den Knopf „Zurück“.
- **Mindmap:** Antippen eines Zwischenstopps öffnet den Dialog „Abzweigung“ (kein eigenes Plus mehr). Neue Abzweigungen
  und Unteräste erben Linie, Form und Knick vom zuletzt dort angehängten Ast bzw. vom Ast selbst, die Farbe leicht
  abgewandelt. Abzweigungen laufen zunächst in Fahrtrichtung des Hauptasts weiter (wie hinter einer Weiche) und liegen
  unter ihm; Linien enden ohne Spalt in der Pfeilspitze. Langer Druck packt den Ansatz: an einem Stopp abzweigen, an
  einem anderen Knoten neu anbinden, auf der Gliederung ablegen oder weit weg loslassen (dann frei, gestrichelt
  angezeigt). Freie Knoten (`card.free`) haben keinen Ast; sie lassen sich anbinden, zum Abschnitt machen oder sammeln
  eigene Ideen wie ein weiteres Zentrum.
- **Cluster (Karten-Ansicht):** Schatten nur, wenn eine Karte herausgehoben ist (gewählt oder gezogen). „Text aus“ gilt
  für alle; einzelne Texte lassen sich danach zeigen, ohne die Einstellung zu ändern. „Als Gliederung“ zeigt einen
  Cluster oder Ast vorübergehend als Linie.
- **Kopfzeile:** Auswahl der Mindmap in der Mitte, Ansicht (Mindmap/Cluster), Auge (Hervorheben) und Gliederung oben
  rechts in der Fläche, neue Knoten oben links. Alle Hinweise stehen in der Erklärung hinter dem i-Knopf.

### 8h.9 Linie oben im Cluster (21. November 2026)

Wunsch von Jo: Wird eine Karte im Cluster direkt unter den Rand gezogen, entsteht dort eine Gliederungslinie. Die Punkte
stehen in einem festen Raster in voller Breite untereinander; ein Klick auf den Anschlusspunkt löst eine Karte wieder.
Die Punkte sind zugeklappt und klappen mit einem Klick auf die Titelleiste auf.

- Karte bekommt das Feld `docked`; `y` ist an der Linie nur die Reihenfolge. Andocken, wenn die Oberkante der gezogenen
  Karte höchstens 18 px unter dem Ende der Linie (bzw. dem Kopf des Clusters) liegt; eingereiht nach der Zeigerlage
  zwischen den vorhandenen Punkten oder vor einem Punkt (obere Kante). Wird eine angedockte Karte woanders abgelegt,
  ist sie wieder frei.
- Die Linie liegt unter Kopf und Text des Clusters, die übrigen Karten beginnen darunter. Karten in einer angedockten
  Karte wandern mit und erscheinen erst aufgeklappt (zugeklappt zeigt der Pfeil ihre Zahl).
- Auf- und Zuklappen gilt nur auf dem eigenen Gerät und wird nicht gespeichert.
- In „Als Gliederung“ und beim Übernehmen eines Clusters kommen angedockte Punkte zuerst, in ihrer Reihenfolge.

### 8h.10 Gliederung als eigener Punkt, Übersicht, Linie am Clusterrand (22. November 2026)

Wünsche von Jo:

- Übersicht: Mindmap, Cluster, Gruppen und Gliederung stehen in einer Zeile („1–3“), danach „4 Recherche und
  Ausarbeitung“ (Notizen und Quellen, Textabschnitte, Arbeitsprozess) und „5 Präsentation und Publikation“. Die
  Themen-Mindmap hat keine eigene Kachel: Solange jemand noch keine Gruppe hat, öffnen Mindmap und Cluster die
  Themen-Mindmap, sobald die Lehrkraft die Phase „Thema“ freigibt. Die Phasen in den Einstellungen bleiben, wie sie sind.
- Gliederung ist eine eigene Seite (`/projekt/gliederung`), erreichbar über die Kachel und ein Symbol oben rechts neben
  Notizen und Chat. Ohne Wahl stehen beide Linien nah nebeneinander (synchrone Gliederung). In der Mitte des Kopfs
  „Präsentation ‖ Ausarbeitung“ genau über den Linien (die Seite misst die Lage); ein Klick lässt die gewählte Linie nach
  links rutschen, daneben erscheint die Ausarbeitung als Text bzw. als Präsentation (Karten des Schreibeditors, 8i) mit
  zartem Farbverlauf. „beides“ in der Seitenleiste führt auf diese Seite.
- Gleiche Hauptpunkte stehen auf einer Höhe, verbunden durch eine hellgraue Linie. Stehen sie vertauscht, verbindet sie
  eine graue Linie mit zwei Bögen; ein Klick verschiebt den Punkt der Präsentation neben sein Gegenstück (`alignPoint`).
- Plus im Kreis am Ende jeder Linie für einen neuen Punkt (auch in der Seitenleiste).
- Punkte lassen sich ziehen: auf die Linie (an dieser Stelle eingesetzt), auf einen Punkt (dahinter), ans Ende. Aus der
  anderen Linie gezogen entsteht eine Kopie mit gleichem Schlüssel (`movePointAfter`).
- `map.outline.praes`: Abschnitte der Präsentationslinie im Format von `sections` für die Präsentation im Schreibeditor.
- Cluster: Die Linie läuft am linken Rand, die Anschlusspunkte sitzen auf dem Rand. Oben links in der Ecke steht ein
  weißer Startkreis; darauf gezogen wird eine Karte der erste Punkt, auf die Linie gezogen steht sie an dieser Stelle.
  Die Reihenfolge an der Linie wird bei jedem Andocken neu vergeben (y = 0, 10, 20 …).
- Offen: Wie zeigt die Präsentationslinie, welche Punkte auf eine Folie kommen (Frage an Jo).

### 8h.11 Seitenmenüs, Mittelachse, Gruppensäulen, Übernehmen (22. November 2026)

Wünsche von Jo:

- Seite Gliederung: Die Knöpfe „Präsentation“ und „Ausarbeitung“ sitzen unten auf der Kopfzeile genau über ihren Linien,
  die Linie beginnt direkt unter dem Knopf und berührt ihn. Die Seite misst die Lage der Linien laufend (ResizeObserver),
  auch wenn das Seitenmenü links oder eine Leiste rechts die Fläche verschiebt.
- Der i-Knopf steht rechts neben dem Chat-Symbol. Die Symbole oben rechts öffnen Seitenleisten: Notizen, Chat und
  jetzt auch die Gliederung (`OutlineSide`); „‖“ darin führt zur Parallelansicht. In der Mindmap schaltet das Symbol die
  Gliederung neben der Mindmap (der Knopf in der Ansichtsleiste entfällt).
- Links wie rechts ist immer nur ein Seitenmenü offen (`lib/sides.ts`): Wer eines öffnet, meldet `announceSide(edge, id)`,
  alle anderen auf derselben Seite schließen sich (`useSideBus`). Eingebettete Oberflächen (Pinnwand, Bento) hören im
  iframe auf `{ type: 'collegare:side-open', edge, id }` und schicken dieselbe Nachricht an `window.parent`, wenn ihre
  eigenen Seitenmenüs aufgehen. Das Seitenmenü links löst dann auch das Anheften.
- Gruppensäulen reichen bis zum unteren Fensterrand: hinter den Karten der bisherige Farbton, darunter ein Verlauf bis 0 %,
  der Rand der Säule bleibt sichtbar.
- Ast oder Cluster in die Gliederung (Knopf oder Ziehen): Rückfrage „Titel, Personen, Farbe“, alles angehakt. Ohne Titel
  wird ein eigener Punkt ohne Verbindung zur Karte, ohne Personen setzt der Punkt `noOwners` (Abschnitte übernehmen dann
  nur die Personen am Punkt), mit Farbe bekommt der Punkt `color` (Kreis gefüllt, in `outline.sections[].color` für den
  Schreibeditor).

### 8h.12 Verdoppeln, Suche an der Linie, Rückseite, Texte vergleichen, Rückfrage der Lehrkraft (22. November 2026)

Wünsche von Jo:

- Einen Punkt aus der einen Linie auf die andere ziehen verdoppelt ihn (gleicher Schlüssel, Kopiecursor beim Ziehen).
  Steht er dort schon, wandert das Gegenstück an die Stelle.
- Ein Klick auf die Linie öffnet an der Stelle die Eingabe für einen neuen Punkt, die zugleich sucht: Karten und Äste
  der Mindmap, Punkte der anderen Linie (werden verdoppelt) und entfernte Punkte (kommen zurück). Enter ohne Auswahl legt
  einen neuen Punkt an. Dieselbe Eingabe hat „neuer Punkt“ am Ende der Linie.
- Vorder- und Rückseite: Steht ein Punkt in beiden Linien, dreht ein Klick auf den farbigen Punkt neben dem Titel die
  Karte um. Die Rückseite zeigt den Punkt der anderen Linie und markiert Unterschiede: Unterpunkte nur dort (+), nur
  hier (−), anderer Titel, ausgeblendet, Objekte.
- Parallelansicht „Texte vergleichen“: Unter jedem Punktpaar stehen die Texte aus Präsentation und Ausarbeitung auf
  gleicher Höhe, die Linien laufen durch, jede Zeile lässt sich einklappen. Die Rückseite ist der schnelle Blick auf die
  Gliederung, der Vergleich der Blick auf die Texte; beides ergänzt sich.
- Lehrkraft in einer Gruppe: Vor der ersten Änderung an der Gliederung fragt ein Fenster „Wollen Sie die Gliederung der
  Gruppe ändern oder lieber eine Nachricht schreiben?“ mit „Nachricht an Gruppe“ (gelbes Post-it „Kommentar für die
  Gruppe …“, kommt im Gruppenchat mit „Zur Stelle springen“ an) und „Gliederung trotzdem ändern“ (gilt dann für diese
  Gruppe bis zum Neuladen). Im eigenen Testbereich und in der Themen-Mindmap fragt nichts.

## 8i. Schreibeditor und Ausarbeitung (21. November 2026)

Wunsch Jo: Die Office-Ansicht der Ausarbeitung weicht einem eigenen, leichten Editor. Geschrieben wird zunächst auf
Karten, die nur die Überschrift tragen; die Gliederung wird von selbst übernommen und synchron gehalten. Standard der
Ausarbeitung ist eine Seite mit Text links und breitem Rand rechts (Randnotizen, Begriffe, Bilder, Zwischentitel,
Statistiken); der Name des Vorbilds (Tufte) erscheint in der Oberfläche nie.

### 8i.1 Stufe 1: Schreiben (gebaut)

- **Karten statt Office:** je Punkt der Gliederung eine Karte (`documents`, Art `word`), nur die Überschrift aus der
  Gliederung, keine eigene Leiste. Punkte ohne Karte (gestrichelt, nur in der Gliederung entstanden) werden selbst ein
  Abschnitt. Verschwindet ein Punkt, bleibt der Text unter „Nicht mehr in der Gliederung“ stehen.
- **Format:** Markdown wie die Lernseiten (`client/lib/tufte.ts`), neu `==hervorgehoben==`. Bearbeitet wird „wie in
  Word“ (`RichText` + `lib/tufteEdit.ts`); Randnotizen, Bemerkungen und Bildunterschriften stehen schon beim Schreiben
  rechts am Rand, auf dem Handy als eingerückter Kasten im Text.
- **Werkzeuge:** über der Markierung Hervorheben, Randnotiz, Begriff (Wort mit Erklärung, gesammelt in „Begriffe“ am
  Ende); im Rand der aktiven Karte „+ Randnotiz“, „+ Bemerkung“, „+ Bild“.
- **Speichern:** von selbst, `PUT /api/documents/:id/text` mit Stand `rev` (409 bei veraltetem Stand, der eigene Text
  gilt, der andere bleibt als Fassung). Tabelle `doc_revisions` (Migration 0021): Fassung alle 10 Minuten oder beim
  Wechsel der Schreibenden, höchstens 40 je Abschnitt; „Frühere Fassungen“ an jeder Karte.
- **Abgleich mit der Gliederung:** beim Öffnen und bei jeder Änderung der Gliederung (Socket `map`) zuerst
  `…/documents/merken`, dann `…/documents/sync`. **„Zurück“** unten (Tooltip „Zurück zu meinem letzten Zustand im
  Editor“) setzt die Texte auf den gemerkten Stand; der Stand davor bleibt als Fassung.
- **Lesen und Drucken:** „Lesen“ zeigt die ganze Ausarbeitung als Webseite (mobil einspaltig), „Drucken“ öffnet sie
  allein in einem Fenster (Text links, Rand rechts, A4).
- Alte Abschnitte aus dem Office-Editor bleiben über „⋯ → Text aus dem früheren Editor“ lesbar (zum Herauskopieren).
- Die Gliederung steht beim Schreiben links (`GliederungLive`), in den Schritten davor rechts (Thread Mindmap/Gliederung).

### 8i.2 Stufe 2: Ausgabe als Webseite und Druck

Texttypen als Bausteine: Zitat mit Satz- bzw. Zeilenzählung, Zwischentitel am Rand, Statistik/Zahl am Rand,
Randabbildung; Schriften einbinden (OFL, im Paket); eigenständige HTML-Datei zum Weitergeben; Druck über Typst
(Entscheidung 14, unsichtbar für Lernende, nur „Für Fortgeschrittene“).

### 8i.3 Stufe 3: Broschüre und Poster

- **Broschüre:** Layoutsysteme (Text innen, Rand außen; 1–3 Spalten oder Boxen), verbundene Textrahmen, gemeinsame
  Oberlinien für Grafiken, Umfluss; Markierung der Bereiche, die die Mittelfalte stört, Berechnung der Mittelseite,
  Umsortieren der Seiten für den Broschürendruck (Ausschießen).
- **Science-Poster:** Spalten, Boxen, Überschriften, Grafiken mit Umfluss und Bildunterschrift; Druck auf mehrere
  Blätter verteilt mit Klebelaschen.

### 8i.4 Stufe 4: Bilder für die Reproduktion

Filter an Bildern der Ausarbeitung: Dithern, Tontrennung, Negativ, Solarisation, Verpixeln, Vektorisieren, Vignette
(im Browser auf Canvas, Original bleibt erhalten).

### 8i.5 Stufe 1b: Schreiben im Panel, Notizen hineinziehen (22. November 2026, gebaut)

Wünsche von Jo vom 22. November 2026:

- Ein Klick ins Panel, und man schreibt direkt (WYSIWYG). Oben am Eintrag steht dann ein fester Kopf mit den
  Werkzeugen, in Gruppen: Grundformen (Fett, Kursiv, Überschrift, Liste, Zitat, Link), „Auszeichnen“ (Hervorheben,
  Begriff) und „Rand“ mit einem Symbol für die Randspalte (Randnotiz nummeriert, Bemerkung ohne Nummer, Bild mit
  Unterschrift).
- Text und Präsentation sind eigene Linien (`documents.line`). In der Präsentation heißt die Randgruppe „Vortrag“:
  Die Randspalte trägt Vortragsnotizen (ohne Nummer), Bilder gehören auf die Folie; nummerierte Randnotizen gibt es nur
  im Text. Hervorheben und Begriffe gelten für beide.
- Ein zarter Farbverlauf (blau für den Text, orange für die Präsentation) zeigt, woran man gerade arbeitet.
- Notizen aus „Notizen und Quellen“ lassen sich in ein Panel ziehen (an der Stelle als Absätze eingesetzt) oder
  zwischen zwei Panels (neuer Punkt der Gliederung mit der Notiz als Objekt und ihrem Text als Anfang).
- Wo eine Notiz verbaut ist (Tabelle `note_uses`, gilt nur, solange der Anfang des Textes noch im Abschnitt steht, oder
  als Objekt an einem Punkt der Gliederung), zeigt die Notiz eine blaue bzw. orange Pille. Ein Klick springt dorthin.
- Die Karten liegen in `components/AusarbeitungCards.tsx` und stehen auch auf der Seite „Gliederung“ neben der Linie.

## 9. Umsetzungsplan

| Meilenstein | Inhalt | Ergebnis / Abnahme |
|---|---|---|
| **M0 Spike** (zuerst) | Node-Server mit socket.io statt MockSocket; zwei Browser bearbeiten dieselbe DOCX und PPTX; Sperre je Absatz/Folie vom Server verweigern; Beitritt mit Änderungsverlauf; Snapshot mit nativem x2t; Einfüge-Ereignis im iframe erfassen. NRPS-Gruppen in Moodle prüfen. | Entscheidung: eigenes Protokoll weiter oder Ausstieg (OnlyOffice Document Server bzw. eigener Texteditor auf ProseMirror/Yjs für Abschnitte). |
| **M1 Fundament** | Repo aus office-website übernehmen, entschlacken, deutsch; Backend, Datenbank, Rechte, Prüfprotokoll; LTI-Start, NRPS-Import; lokale Konten und QR-Zugang; Phase 0 Kanban mit Einzelmodus; Einstellungsseite mit den Akkordeons Projekt, Gruppenbildung (einschließlich Wahlmodus) und Dokumente | Start aus Moodle zeigt Projekt; Gruppen bilden auf dem Board |
| **M2 Orientierung und Recherche** | Mindmap, Gliederung, Rollen; Notizen mobil/offline mit Thread; Literaturliste; Fotos mit Texterkennung | Gruppe erstellt Gliederung aus Mindmap, Notizen vom Handy erscheinen live |
| **M3 Ausarbeitung** | Abschnitts-Dokumente, Gesamtansicht, Fertig-Sperre, Logbuch, Einfüge-Protokoll (auch für Importe), Zeitleiste, Beitragsübersicht, Formeleditor | Sperren greifen serverseitig; Zeitleiste spielt einen Abschnitt ab |
| **M4 Feedback und Bewertung** | Peer-Review, KI-Feedback für Lernende, Kategorien, Zwischenfeedback, KI-Entwurf für die Lehrkraft, AGS | Note und Zwischenkommentar landen im Moodle-Gradebook |
| **M5 Präsentation** | Folien- und Handout-Vorlagen, Vorlagenbibliothek, Quarto/Typst-Export, Präsentation als HTML (Bento), Verteidigungsmodus im Bento-Player, Prozess-Logbuch als PDF | Export einer Beispielarbeit im Tufte-Stil |
| **M6 Optionales** | Tippfluss-Analyse (nach DSFA-Vorlage), Deep Linking, Moodle-Gruppenimport, Autogra.fi-Abgabe, Archiv und Ruhespeicher in Moodle mit Moodle-Plugin (7.9) | jeweils einzeln abnehmbar |
| **Langfristig** | App für iOS/Android über Capacitor, ggf. Desktop über Tauri, gemeinsame Schul-App mit Autogra.fi (Abschnitt 7.8) | App aus dem Store verbindet sich per Schul-QR mit der eigenen Instanz |

---

## 10. Entscheidungen und offene Fragen

Entschieden (Jo, 1. November 2026):

1. **Backend:** TypeScript/Node (7.4).
2. **Betrieb:** direkt auf der VM ohne Docker (7.7), auf derselben VM wie Autogra.fi im Unterordner `/collegare`.
3. **Gruppen:** zunächst nur Gruppenbildung im Kanban; kein Moodle-Gruppenimport.
4. **Sperr-Einheit:** die **Karte, die einer Person zugeordnet ist** (Karte der Gliederung = Abschnitt), danach die **Folie**. Keine Sperre einzelner Absätze; das spart die im Spike offen gebliebene Absatz-ID-Ermittlung.
5. **Tippfluss-Hinweise:** Die Administration legt den Rahmen fest (aus, nur Lernende, Lernende und Lehrkraft); innerhalb dieses Rahmens entscheidet die Lehrkraft je Projekt, ob sie Hinweise und Antworten sieht.
6. **Zielgruppe:** Oberstufe. Zitierstil, Vorlagen und Ton der Hinweise richten sich danach.
7. **Moodle:** Es laufen verschiedene Moodle-Systeme in verschiedenen Versionen; auf dem hamburgweiten Moodle lassen sich (noch) keine Plugins installieren, auf dem Schul-Moodle schon, besser aber ohne. **Grundlage ist daher nur LTI 1.3 mit AGS und NRPS** (ab Moodle 3.7 enthalten). Archiv und Ruhespeicher (7.9) sind Zusatz für Umgebungen, die die Ablage-Schnittstelle anbieten; ein Moodle-Plugin wird erst gebaut, wenn es gebraucht wird.
8. **Formeleditor und Bento-Konverter** (aus mod_pinnwand und mod_bento): Sie stehen unter derselben nicht-kommerziellen Lizenz wie der Kern (Entscheidung 9) und gehören deshalb **direkt in den Kern** (`client/`). Die zuerst gewählte Lösung als getrennt geholte Erweiterung entfällt. Wichtig: Sie laufen in der Projektoberfläche, nicht im Office-iframe; eine Formel kommt per `postMessage` als Gleichung oder Bild ins Dokument. KaTeX, JSZip und die Bento-Datei stehen unter MIT.
9. **Lizenzen getrennt** (1. November 2026): Der **Kern** (`server/`, `client/` mit Kanban, Mindmap, Notizen, Einstellungen) steht unter Jos nicht-kommerzieller Lizenz wie mod_pinnwand; der **Office-Teil** `web/` bleibt AGPL-3.0, mit unveränderten OnlyOffice-Hinweisen und -Logos. Kein Code wird zwischen beiden Teilen kopiert oder importiert. Beiträge zum Kern stehen unter dieser Lizenz und dürfen von Jo auch anders lizenziert werden. Stände bis Commit `36910cb` bleiben AGPL. Einzelheiten in `LIZENZEN.md`.

10. **Module** (9. November 2026): Collegare wird Plattform für Module (Abschnitt 8a). Die Anforderungen dort gelten
    für neue Teile ab jetzt; die heutigen Oberflächen werden schrittweise als Module beschrieben.
11. **Mehrere Aufgaben verfolgen** (9. November 2026): Portal und Dienstschnittstelle „Aufgaben-Übersicht“ wie in 8b.
12. **Collegare ist der Kontodienst** (11. November 2026, Jo): Collegare entspricht im Aufbau der Ausschreibung,
    Autogra.fi ist ein Zusatz. Laufen beide, stellt Collegare die Konten per OpenID Connect aus (Abschnitt 8c).

13. **Eigener Editor statt OnlyOffice** (11. November 2026, Jo): Perspektivisch ersetzen eigene Editoren das
    eingebettete OnlyOffice. Gründe: Ladezeit (unter 1 MB statt 15–30 MB, Wechsel zwischen Abschnitten ohne
    Neustart), volle Kontrolle über Sperren, Herkunft und Tippfluss, eine einzige Lizenz. Reihenfolge:
    (1) Textabschnitte mit ProseMirror/Tiptap (nur freie Erweiterungen) und Yjs, (2) Präsentation mit dem Editor aus
    mod_bento und einem Menüband wie PowerPoint im Office-Streifen, (3) Tabellen (Univer oder FortuneSheet), bis dahin
    OnlyOffice. Word/PowerPoint nur über Import und Export (mammoth, docx, PptxGenJS). Alle Bausteine stehen unter MIT,
    BSD oder Apache und dürfen in den Kern; sind alle drei Arten ersetzt, entfällt `web/` samt AGPL. Vorher prüfen:
    mod_bento-Code nur von Jo oder mit Rechteeinräumung.
14. **Export über Typst, Quarto als Austauschformat** (11. November 2026, Jo): Auf dem Server läuft nur Typst
    (Apache-2.0, ein Programm); Quarto (MIT) und Pandoc (GPL) werden nicht mitgeliefert. Eine Datei
    `DRITTANBIETER.md` im Paket nennt Lizenzen und Hinweise (Typst, CSL-Stile CC BY-SA, Schriften OFL).

Offen:

- Termin für den ersten Einsatz.
- Erstes Modul: „Notiz scannen“ über Autogra.fi (Vorschlag 8a.6).
- GeoGebra: Lizenz für Selbst-Hosten und Datenschutz klären.
