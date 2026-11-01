/** Spaltenfarben wie in brausa (core/map.ts STATUS_DEFAULTS). */
export const COLUMN_COLORS = ['#64748b', '#f59e0b', '#10b981', '#0090ff', '#8b5cf6', '#ec4899', '#ef4444'];

export function groupColor(color: string | null, index: number): string {
  return color ?? COLUMN_COLORS[(index + 1) % COLUMN_COLORS.length];
}
