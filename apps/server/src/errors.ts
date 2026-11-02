import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@de-trainer/core';
import { ContentError } from './content/service';

type Issue = { path: string; message: string };

/** Errors carry a code, a message and field paths; never stack traces or secrets (A15). */
export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string, issues?: Issue[]) {
  return c.json({ error: { code, message, ...(issues ? { issues: issues.slice(0, 100) } : {}) } } satisfies ApiError, status);
}

export function handleContentError(c: Context, err: unknown): Response {
  if (err instanceof ContentError) return apiError(c, err.status, err.code, err.message, err.issues);
  throw err;
}

/** Parses a JSON body; a malformed one is the client's error, not a 500. */
export async function readJson(c: Context): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false, res: apiError(c, 400, 'invalid_json', 'Request body must be JSON') };
  }
}
