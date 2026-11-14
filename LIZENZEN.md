# Lizenzen in diesem Repository

| Teil | Lizenz | Warum |
|---|---|---|
| Collegare-Kern: `server/`, `client/` (Projektoberfläche: Kanban, Mindmap, Notizen, Einstellungen), `docs/`, `scripts/` | nicht-kommerziell, siehe [`LICENSE`](LICENSE) | eigener Code, gleiche Lizenz wie mod_pinnwand und mod_bento |
| Office-Teil: `web/` | AGPL-3.0, siehe [`web/LICENSE.txt`](web/LICENSE.txt) | Fork von office-website mit den OnlyOffice-Editoren (sdkjs, web-apps, x2t), die unter AGPL-3.0 stehen |
| OnlyOffice-Dateien in `web/public/v*/` (nicht im Repository, per Skript geholt) | AGPL-3.0 mit den Zusatzbedingungen von Ascensio System SIA | Hinweise und Logos von OnlyOffice bleiben unverändert erhalten |
| Folien-Oberfläche aus [Bento](https://github.com/lasjoh-toho/bento) in `client/public/bento/` (nicht im Repository, per `scripts/bento-holen.sh` gebaut) | MIT, siehe `LICENSE-bento` dort | eigenständige Ein-Datei-App; der Kern lädt sie im iframe und spricht sie nur per `postMessage` und über `/api/documents/:id/bento` an |
| PowerPoint-Import `bentoconvert.js` aus mod_bento (ebenda, nur der Umwandlungsteil) | nicht-kommerziell wie der Kern, siehe `LICENSE-bentoconvert.md` | gleicher Rechteinhaber |
| Bibliotheken über npm (Fastify, socket.io, Kysely, zod, KaTeX, JSZip …) | jeweils eigene, freie Lizenz (MIT, Apache-2.0, BSD) | in `package.json` aufgeführt |

## Installation auf Servern

| Wo Collegare läuft | Genehmigung nötig? |
|---|---|
| Auf eigenen Servern einer Schule | nein |
| Auf Servern eines Unternehmens, das ein Schulträger beauftragt hat (Hosting- oder IT-Dienstleister) | ja, vorherige schriftliche Genehmigung von `lasjoh-toho` |

Die Genehmigung ist auch dann nötig, wenn der Einsatz an der Schule selbst nicht kommerziell ist. Anfragen über GitHub-Issues oder direkt an den Repository-Inhaber.

## Trennung von Kern und Office-Teil

Der Kern enthält keinen Code aus OnlyOffice oder office-website. Er bindet die Editoren nur als eigenständiges Programm ein:

- im Browser über ein **iframe** auf den statischen Export von `web/` und Nachrichten per `postMessage`;
- auf dem Server über das **Kollaborationsprotokoll** (socket.io, Namespace `/collab`). `server/src/collab/` ist eine eigene Umsetzung des Nachrichtenformats, nicht aus dem OnlyOffice-Server übernommen.

Änderungen an `web/` (z. B. die Weiterleitung des Protokolls in `web/utils/editor/server.ts`) bleiben AGPL und werden mit veröffentlicht. Kein Code aus `web/` wird in `client/` oder `server/` kopiert oder importiert; umgekehrt ebenso.

## Beiträge

Wer zum Kern beiträgt, erklärt sich damit einverstanden, dass der Beitrag unter der Lizenz in `LICENSE` steht und dass der Rechteinhaber (`lasjoh-toho`) ihn auch unter anderen Bedingungen lizenzieren darf (z. B. später eine freie Lizenz oder eine Genehmigung für kommerzielle Nutzung). Beiträge zu `web/` stehen unter AGPL-3.0.

Ältere Stände dieses Repositorys bis einschließlich Commit `36910cb` wurden unter AGPL-3.0 veröffentlicht; für diese Stände gilt die AGPL weiter.

Dies ist keine Rechtsberatung.
