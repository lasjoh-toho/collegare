import type { Metadata } from "next";
import { SettingsView } from "@/components/main/settings-view";

export const metadata: Metadata = {
  title: "Settings — ZIZIYI Office",
  description:
    "Customize your ZIZIYI Office experience: change editor theme, language, and plugin preferences.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SettingsPage() {
  return <SettingsView />;
}
