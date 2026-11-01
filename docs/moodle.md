# Collegare in Moodle einbinden (LTI 1.3)

Getestet gegen eine nachgebaute Moodle-Plattform (Protokolltests in `server/test/lti.test.ts`); der erste Test mit Moodle 4.4 steht noch aus.

## 1. Tool in Moodle anlegen

Website-Administration › Plugins › Aktivitäten › Externes Tool › **Tools verwalten** › „Tool manuell konfigurieren“.

Die Werte stehen in Collegare unter **Verwaltung › Moodle-Verbindung** zum Kopieren:

| Feld in Moodle | Wert |
|---|---|
| LTI-Version | LTI 1.3 |
| Tool-URL | `https://<server>/collegare/lti/launch` |
| Öffentlicher Schlüsseltyp | Schlüsselsatz-URL |
| Schlüsselsatz-URL | `https://<server>/collegare/lti/jwks` |
| Login-URL | `https://<server>/collegare/lti/login` |
| Weiterleitungs-URI(s) | `https://<server>/collegare/lti/launch` |
| Standard-Startcontainer | **Neues Fenster** (eingebettet blockieren viele Browser das Anmelde-Cookie) |
| Dienste | IMS LTI Assignment and Grade Services: „für Bewertungssynchronisation und Spaltenverwaltung“; IMS LTI Names and Role Provisioning: „Mitgliedsinformationen abrufen“ |
| Datenschutz | Name an das Tool senden: immer; E-Mail: nie |

## 2. Moodle in Collegare eintragen

In Moodle bei dem neuen Tool die Lupe „Konfigurationsdetails anzeigen“ öffnen. In Collegare unter **Moodle-Verbindung** die Adresse des Moodle eingeben (füllt Plattform-ID, Authentifizierungs-, Schlüsselsatz- und Token-URL aus) und **Client-ID** und **Deployment-ID** aus Moodle übernehmen.

## 3. Im Kurs nutzen

1. Lehrkraft fügt im Kurs die Aktivität „Externes Tool“ hinzu und wählt Collegare.
2. Beim ersten Öffnen legt die Lehrkraft das Projekt an (Titel, Gruppen oder einzeln); die Lernenden des Kurses werden übernommen.
3. Danach öffnen alle die Aktivität und landen direkt im Projekt. Neu hinzugekommene Lernende kommen beim ersten Öffnen dazu oder über „↻ Aus Moodle“ im Projekt.

Lernende brauchen in diesem Fall keine Zugangscodes; QR-Codes bleiben für Gäste oder Kurse ohne Moodle.
