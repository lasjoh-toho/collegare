import { useEffect } from "react";

/**
 * Client-side document.title override for i18n.
 * SSG metadata stays in English for SEO; this updates the title
 * for users who switch languages on the client.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
