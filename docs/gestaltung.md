# Gestaltungsrichtlinie Autogra.fi und Collegare

Stand: 1. November 2026, Entscheidungen von Jo. Gilt für beide Apps. Diese Datei liegt in Collegare
(`docs/gestaltung.md`); Autogra.fi verweist darauf. Änderungen nur nach Rücksprache mit Jo.

Ziel: Wer eine der beiden Apps kennt, erkennt die andere sofort und findet sich zurecht. Lehrkräfte sollen später
alle Aufgaben aus beiden Apps an einer Stelle sehen.

## 1. Grundsätze

1. **Gleiches gleich:** Was es in beiden Apps gibt (Portal, Verwaltung, Einstellungen, Korrektur, Info-Menü), sieht
   gleich aus und wird gleich bedient. Vorbild ist jeweils Autogra.fi.
2. **Inhalte vor Marke:** Die Bedienoberflächen sind neutral grau. Farbe tragen nur Zustände, die Art eines Dokuments
   und die Marke an wenigen Stellen. Nichts in der Oberfläche darf die Farben von Inhalten (z. B. einer Präsentation)
   beeinflussen oder sich mit ihnen beißen.
3. **Kein Code-Austausch:** Beide Apps teilen Regeln und Farbwerte, keinen Code (verschiedene Technik und Lizenzen,
   siehe `LIZENZEN.md`). Jede App hält die Farbwerte in ihrer eigenen Datei mit denselben Namen und Werten.
4. **Abweichungen begründen:** Wer von dieser Richtlinie abweicht, schreibt den Grund in die Abweichungstabelle des
   README der jeweiligen App.

## 2. Farben

### Oberflächen: Tag und Nacht

Die Bedienoberflächen (Menüs, Leisten, Seitenmenü, Verwaltung, Korrektur) sind im Tagmodus hellgrau, im Nachtmodus
dunkelgrau, jeweils mit einem zarten Verlauf. Das heutige dunkle Portal von Autogra.fi wird zum Nachtmodus.

- Der Modus folgt zuerst der Einstellung des Geräts (`prefers-color-scheme`).
- Ein **Tag/Nacht-Schalter unten im Seitenmenü** und im Portal überschreibt das; die Wahl gilt je Konto
  (ohne Anmeldung im Browser gespeichert).
- Umsetzung über `data-theme="light" | "dark"` am `<html>`-Element und gemeinsame Farbnamen (Abschnitt 8).

### Marke

| App | Markenverlauf | Wo |
|---|---|---|
| Autogra.fi | Blau, `#003264` → `#0055a5` | Logo, Startseite, Willkommenskarte (wie bisher) |
| Collegare | Rot-Orange, analog zum blauen Verlauf | Logo, Startseite |

Der Markenverlauf erscheint **nie** in Editoren, Mindmap, Kanban, Korrekturansicht oder neben Inhalten der
Lernenden, damit er deren Farben nicht beeinflusst.

### Art des Office-Dokuments

| Art | Farbe |
|---|---|
| Text | Blau `#2b579a` |
| Präsentation | Rot-Orange `#b7472a` |
| Tabelle | Grün `#217346` |

Diese Farben kennzeichnen die Art eines Dokuments: im Streifen über dem Editor (Abschnitt 5) und auf den Kacheln.

### Zustände

| Zustand | Darstellung |
|---|---|
| nicht vorhanden / noch nicht begonnen | gestrichelter Rahmen (wie fehlende Seiten in Autogra.fi) |
| vorhanden, nicht freigegeben | grau |
| freigegeben | farbig (Farbe der Phase bzw. Art) |
| „fertig“ gemeldet | farbig mit Haken |

## 3. Verwaltung, Portal und Aufgabeneinstellungen

- Es gibt **eine** Verwaltung: Aufgabenportal, Lehrkräfte, KI-Verwaltung und Aufgabeneinstellungen. Aufbau und
  Bedienung folgen Autogra.fi (`/portal`, Lehrenden-Seiten, `einstellungen.html`: Voreinstellungen, Akkordeons, ein
  Speichern, Export/Import).
- Die Verwaltung muss **auch funktionieren, wenn nur eines der beiden Module installiert ist.** Jede App bringt
  sie also mit; sind beide installiert, nutzen sie eine gemeinsame (gleiche Klassen, Konten, Anmeldung) und das
  Portal zeigt die Aufgaben beider Apps.
- Bis die gemeinsame Verwaltung steht, halten beide Apps Begriffe, Spalten, Knöpfe und Reihenfolge gleich, damit der
  Umzug später nur ein Umzug ist.

## 4. Korrektur

- Aufbau wie die Korrektur von Autogra.fi: Warteschlange, Arbeitsfläche, Notenblase, Notizen, KI-Rückmeldung.
- Wo Autogra.fi links die Blätter zeigt, zeigt Collegare die **Phasen und Produkte** des Projekts (Mindmap,
  Gliederung, Textabschnitte, Folien, Notiz-Thread) mit den Zuständen aus Abschnitt 2.
- Collegare kann die Warteschlange **nach Gruppen ordnen** (eine Zeile je Gruppe, aufklappbar zu den Mitgliedern;
  bei jedem Produkt steht, wer zuständig ist). Das ist nur eine Sortierung: Noten bleiben je Person.

## 5. Office-Editoren

- **Keine eigene Leiste über OnlyOffice.** OnlyOffice behält sein Menüband unverändert (Hinweise und Logos bleiben).
- Oben ein **etwa 1,5 mm (6 px) dünner Streifen in kräftiger Farbe der Office-Art** (Abschnitt 2).
- Optional ein **zarter Verlauf** in dieser Farbe als Hintergrund von Menü und Menüband.
- Titel, Zustand und „Fertig“ stehen im Seitenmenü bzw. an einer Stelle, die keine Höhe kostet.

## 6. Schüleransicht: Seitenmenü

- Das verbindende Element beider Apps ist das **Seitenmenü** (der Info-Streifen). Vorbild ist die Info aus der
  mobilen Ansicht von Autogra.fi (`/lernen`, Schritt „Info“ und Schrittleiste).
- Es öffnet sich von links mit einem **Klick auf Name oder Klasse oben links**, auf allen Geräten gleich. Auf breiten
  Bildschirmen darf es angeheftet bleiben.
- Inhalt: die Phasen (in Autogra.fi die Schritte) der Reihe nach, je Phase die Handlungsanleitung, der Zustand und ein
  Link zur passenden Oberfläche. Unten der Tag/Nacht-Schalter.

## 7. Kacheln

Wenn kein Editor offen ist, zeigt Collegare alle verfügbaren Oberflächen als **Kacheln** (Symbol, Name, Zustand),
wie die Startseite von Office oder die Projektkacheln in brausa. Nicht freigegebene Oberflächen sind ausgegraut, mit
Hinweis, ab wann sie kommen. Office-Kacheln tragen ihre Office-Farbe; die übrigen bleiben grau.

## 8. Gemeinsame Farbnamen

Beide Apps verwenden diese CSS-Variablen (Werte für Tag/Nacht in der jeweiligen App, gleich gehalten):

| Name | Zweck |
|---|---|
| `--ui-bg`, `--ui-bg-2` | Hintergrund der Oberfläche, Anfang und Ende des zarten Verlaufs |
| `--ui-panel`, `--ui-border` | Karten, Menüs, Rahmen |
| `--ui-text`, `--ui-muted` | Schrift, Nebenschrift |
| `--ui-accent` | Knöpfe, Fokus, Auswahl (neutral, nicht Markenfarbe) |
| `--brand-1`, `--brand-2` | Markenverlauf (nur Logo und Startseite) |
| `--office-word`, `--office-slide`, `--office-cell` | Art des Dokuments |
| `--state-missing`, `--state-draft`, `--state-released`, `--state-done` | Zustände |

## 9. Vorbilder für einzelne Bausteine

Kanban, Mindmap und Notiz-Thread folgen im Aufbau weiter brausa (siehe README, Abweichungstabelle); ihre Farben kommen
aus den gemeinsamen Farbnamen. Teile aus Autogra.fi (Scanner, QR-Kopplung, Codeeingabe) behalten ihre Bedienung.

## Stand der Umsetzung

Noch nicht umgesetzt: gemeinsame Farbnamen, Tag/Nacht, Seitenmenü, Kacheln, Office-Streifen, Collegare-Korrektur,
gemeinsame Verwaltung. Reihenfolge: Farbnamen und Tag/Nacht in beiden Apps; Seitenmenü und Kacheln in Collegare vor
dem ersten Kurs; Korrektur für Collegare; gemeinsame Verwaltung nach dem ersten Kurs.
