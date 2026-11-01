/** Bezeichnungen der Dokument-, Import- und Exportarten (Einstellungsseite und Rahmen der Verwaltung). */
export const DOC_LABELS: Record<string, string> = {
  section: 'Abschnitt (Text)',
  slides: 'Präsentation',
  handout: 'Handout',
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
  groups: 'Gruppenbildung',
  orientation: 'Orientierung',
  research: 'Recherche',
  drafting: 'Ausarbeitung',
  presentation: 'Präsentation',
};
