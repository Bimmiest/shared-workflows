import { clamp } from './clamp.js';

/** The number in `text`, from 0 to 100, or null when `text` is not a number. */
export function parsePercent(text: string): number | null {
  const n = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(n)) return null;
  return clamp(n, 0, 100);
}
