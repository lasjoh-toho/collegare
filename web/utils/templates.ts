import templatesData from "@/public/files/templates.json";

export interface Template {
  name: string;
  filename: string;
  preview: string;
  type: "pptx" | "docx" | "xlsx";
  category: string;
}

export function getTemplates(): Template[] {
  return templatesData as Template[];
}

export function getRecommendedTemplates(count = 4): Template[] {
  return getTemplates().slice(0, count);
}

export function getCategories(): string[] {
  return Array.from(new Set(getTemplates().map((t) => t.category)));
}
