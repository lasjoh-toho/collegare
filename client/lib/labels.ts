/** Bezeichnungen der Dokument-, Import- und Exportarten (Einstellungsseite und Rahmen der Verwaltung). */
export const DOC_LABELS: Record<string, string> = {
  section: 'Abschnitt (Text)',
  slides: 'Präsentation',
  handout: 'Handout',
  brochure: 'Gemeinsame Broschüre aller Gruppen',
  sheet: 'Tabelle',
  pdf: 'PDF ansehen und kommentieren',
  formula: 'Formeln',
};
export const IMPORT_LABELS: Record<string, string> = {
  text: 'Textdokumente (DOCX, ODT, RTF, TXT, MD)',
  slides: 'Präsentationen (PPTX, ODP, PPT)',
  sheets: 'Tabellen (XLSX, ODS, CSV)',
  pdf: 'PDF',
  images: 'Bilder (JPG, PNG, HEIC)',
  bib: 'Literatur (BibTeX, RIS)',
};
export const EXPORT_LABELS: Record<string, string> = {
  docx: 'Word (DOCX)',
  pdf: 'PDF',
  pptx: 'PowerPoint (PPTX)',
  bento: 'Präsentation als HTML (Bento)',
  quarto: 'Ausarbeitung im Tufte-Stil (HTML/PDF)',
};
export const PHASE_LABELS: Record<string, string> = {
  topic: 'Thema umreißen',
  groups: 'Gruppenbildung',
  orientation: 'Orientierung',
  research: 'Recherche',
  drafting: 'Ausarbeitung',
  presentation: 'Präsentation',
};

/** Ergebnisse eines Projekts: was am Ende abgegeben bzw. vorgestellt wird (Einstellungsseite, „Ergebnisse“). */
export const RESULT_TYPES: { key: string; label: string; help: string }[] = [
  { key: 'section', label: 'Schriftliche Ausarbeitung', help: 'Jede Person schreibt ihre Abschnitte; zusammen ergeben sie die Ausarbeitung der Gruppe.' },
  { key: 'slides', label: 'Präsentation', help: 'Folien der Gruppe für den Vortrag.' },
  { key: 'handout', label: 'Handout', help: 'Kurze Zusammenfassung je Gruppe für die Klasse.' },
  { key: 'brochure', label: 'Gemeinsame Broschüre aller Gruppen', help: 'Jede Gruppe liefert ihren Teil; daraus entsteht ein gemeinsames Heft der Klasse.' },
];
