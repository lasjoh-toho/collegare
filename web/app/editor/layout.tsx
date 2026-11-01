import type { Metadata } from "next";
import { PropsWithChildren } from "react";

export const metadata: Metadata = {
  title: "Document Editor — ZIZIYI Office",
  description:
    "Edit Word, Excel, and PowerPoint files directly in your browser. No upload, no server — fully private.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function Layout({ children }: PropsWithChildren<unknown>) {
  return <>{children}</>;
}
