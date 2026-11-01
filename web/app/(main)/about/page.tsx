import type { Metadata } from "next";
import { AboutView } from "@/components/main/about-view";

export const metadata: Metadata = {
  title: "About — ZIZIYI Office",
  description:
    "ZIZIYI Office is a serverless, privacy-first office suite powered by OnlyOffice. Edit documents entirely in your browser — no data ever leaves your device.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AboutPage() {
  return <AboutView />;
}
