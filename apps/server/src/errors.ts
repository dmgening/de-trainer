import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@de-trainer/core';

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } } satisfies ApiError, status);
}
