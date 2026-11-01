"use client";

import {
  FileText,
  Sheet,
  Presentation,
  FileType2,
  Files,
} from "lucide-react";
import Image from "next/image";
import { PropsWithChildren } from "react";
import { useRouter } from "next/navigation";
import { useExtracted } from "next-intl";
import { cn } from "@/lib/utils";

export function Header({ children }: PropsWithChildren<{ className?: string }>) {
  const router = useRouter();
  const t = useExtracted();
  const quickActions = [
    {
      type: "docx",
      icon: FileText,
      color:
        "text-blue-600 bg-blue-50 dark:bg-blue-900/40 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/60",
    },
    {
      type: "xlsx",
      icon: Sheet,
      color:
        "text-green-600 bg-green-50 dark:bg-green-900/40 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/60",
    },
    {
      type: "pptx",
      icon: Presentation,
      color:
        "text-orange-600 bg-orange-50 dark:bg-orange-900/40 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/60",
    },
    {
      type: "pdf",
      icon: FileType2,
      color:
        "text-red-600 bg-red-50 dark:bg-red-900/40 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60",
    },
  ];

  return (
    <header className="h-16 flex items-center justify-between px-4 z-20 w-full shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center">
          <Image width={40} height={40} src="/logo.svg" className="w-10 h-10" alt="ZIZIYI Office logo" />
        </div>
        <h1 className="text-xl font-extrabold tracking-normal text-foreground leading-5">
          {"ZIZIYI OFFICE"}
        </h1>
      </div>

      {children}

      <div className="hidden md:flex items-center gap-2">
        {quickActions.map((action) => (
          <button
            key={action.type}
            onClick={() => router.push(`/editor?new=${action.type}`)}
            className={cn(
              "p-2 rounded-lg transition-all duration-200 flex items-center justify-center cursor-pointer",
              action.color,
            )}
            title={t("New {type}", { type: action.type })}
          >
            <action.icon className="w-5 h-5" />
          </button>
        ))}
      </div>
    </header>
  );
}
