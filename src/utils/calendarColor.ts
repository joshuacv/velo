import type { CSSProperties } from "react";

/** Used when a calendar has no color set yet. */
export const DEFAULT_CALENDAR_COLOR = "#6366f1";

const HEX_RE = /^#([0-9a-f]{6})$/i;

/** Converts "#rrggbb" to "rgba(r, g, b, alpha)". Returns null for anything else (custom CSS color names, malformed values, etc.). */
export function hexToRgba(hex: string, alpha: number): string | null {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1]!, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A value safe to hand to an `<input type="color">` — falls back to the default when unset or non-hex. */
export function toColorInputValue(color: string | null | undefined): string {
  return color && HEX_RE.test(color) ? color : DEFAULT_CALENDAR_COLOR;
}

/**
 * Inline style for an event pill tinted with its calendar's color — a light
 * tinted background plus solid-color text. Returns an empty object when no
 * color is set, so callers can fall back to their default Tailwind classes.
 */
export function eventColorStyle(color: string | null | undefined): CSSProperties {
  if (!color) return {};
  const bg = hexToRgba(color, 0.14);
  return bg ? { backgroundColor: bg, color } : { color };
}
