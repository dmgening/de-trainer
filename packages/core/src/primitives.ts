import { z } from 'zod';

/** Stable machine IDs: latin letters, digits and . _ : - (no spaces, no slashes). */
export const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/, 'Expected an ID: latin letters, digits, . _ : -');

export const Uuid = z.uuid();
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase hex sha256');
export const IsoDateTime = z.iso.datetime({ offset: true });
export const LocalDate = z.iso.date();

// Package content is untrusted: the UI renders it as text only, and HTML-looking input is refused up front.
const HTML_LIKE = /<\s*[A-Za-z!/?]|&#?[A-Za-z0-9]+;/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !HTML_LIKE.test(s), 'HTML markup and entities are not allowed')
    .refine((s) => !CONTROL.test(s), 'Control characters are not allowed');

/** Key for objects of different kinds in one map: `exercise:ex-1`. */
export const objectKey = (kind: string, id: string) => `${kind}:${id}`;

/** Deterministic JSON: object keys sorted, so equal content gives equal text and hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** RFC 9562 UUIDv7: time-ordered, generated on the device. */
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** YYYY-MM-DD of a Date in the device's local time zone. */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
