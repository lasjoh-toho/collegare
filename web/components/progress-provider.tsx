"use client";

import { AppProgressProvider } from "@bprogress/next";
import { PropsWithChildren } from "react";

export function ProgressProvider({ children }: PropsWithChildren) {
  return (
    <AppProgressProvider
      height="4px"
      color="#FF5900"
      options={{ showSpinner: false }}
      shallowRouting
    >
      {children}
    </AppProgressProvider>
  );
}
