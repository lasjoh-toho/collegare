import {
  FileText,
  Sheet,
  Presentation,
  FileType2,
  LucideIcon,
} from "lucide-react";

export interface DocumentTypeConfig {
  type: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  hoverBgColor: string;
  hoverBorderColor: string;
  lightBgColor: string;
}

export const DOCUMENT_TYPES: Record<string, DocumentTypeConfig> = {
  docx: {
    type: "docx",
    icon: FileText,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
    hoverBgColor: "group-hover:bg-blue-600",
    hoverBorderColor: "hover:border-blue-300 dark:hover:border-blue-700",
    lightBgColor: "bg-blue-100",
  },
  doc: {
    type: "doc",
    icon: FileText,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
    hoverBgColor: "group-hover:bg-blue-600",
    hoverBorderColor: "hover:border-blue-300 dark:hover:border-blue-700",
    lightBgColor: "bg-blue-100",
  },
  xlsx: {
    type: "xlsx",
    icon: Sheet,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/50",
    hoverBgColor: "group-hover:bg-green-600",
    hoverBorderColor: "hover:border-green-300 dark:hover:border-green-700",
    lightBgColor: "bg-green-100",
  },
  xls: {
    type: "xls",
    icon: Sheet,
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/50",
    hoverBgColor: "group-hover:bg-green-600",
    hoverBorderColor: "hover:border-green-300 dark:hover:border-green-700",
    lightBgColor: "bg-green-100",
  },
  pptx: {
    type: "pptx",
    icon: Presentation,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
    hoverBgColor: "group-hover:bg-orange-600",
    hoverBorderColor: "hover:border-orange-300 dark:hover:border-orange-700",
    lightBgColor: "bg-orange-100",
  },
  ppt: {
    type: "ppt",
    icon: Presentation,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
    hoverBgColor: "group-hover:bg-orange-600",
    hoverBorderColor: "hover:border-orange-300 dark:hover:border-orange-700",
    lightBgColor: "bg-orange-100",
  },
  pdf: {
    type: "pdf",
    icon: FileType2,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50",
    hoverBgColor: "group-hover:bg-red-600",
    hoverBorderColor: "hover:border-red-300 dark:hover:border-red-700",
    lightBgColor: "bg-red-100",
  },
};

export function getDocConfig(type: string): DocumentTypeConfig {
  const normalizedType = type.toLowerCase().replace(".", "");
  return (
    DOCUMENT_TYPES[normalizedType] || {
      type: "unknown",
      icon: FileText,
      color: "text-primary",
      bgColor: "bg-primary/5",
      hoverBgColor: "group-hover:bg-primary",
      hoverBorderColor: "hover:border-primary/50",
      lightBgColor: "bg-primary/10",
    }
  );
}
