"use client";

import { useState, useEffect } from "react";
import { X, Zap } from "lucide-react";
import { useExtracted } from "next-intl";
import { isExtensionAvailable, EXTENSION_STORE_URL } from "@/utils/extension";

const STORAGE_KEY = "dismiss:get_ext";

export function ExtensionPrompt() {
  const t = useExtracted();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!EXTENSION_STORE_URL) return;
    if (isExtensionAvailable()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[340px] bg-popover rounded-xl shadow-lg ring-1 ring-foreground/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Zap className="w-[18px] h-[18px] text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-foreground leading-snug">
                {t("Make your browser an Office app")}
              </p>
              <button
                onClick={dismiss}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              {t("Documents you download or drag in will open for editing automatically — no extra steps.")}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <a
                href={EXTENSION_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="px-3.5 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                {t("Get the Extension")}
              </a>
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("Later")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
