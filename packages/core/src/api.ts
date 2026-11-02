import { z } from 'zod';

/** Content schema version understood by this build; bumped when the package contract changes. */
export const SCHEMA_VERSION = 1;

export const PERMISSIONS = [
  'events:read',
  'events:write',
  'recommendations:write',
  'scheduler:write',
  'bank:publish',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export const GrantScope = z.enum(['user', 'bank']);
export type GrantScope = z.infer<typeof GrantScope>;

export const MeResponse = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string(),
  banks: z.array(z.object({ bank_id: z.string(), title: z.string(), role: z.string() })),
  schema_version: z.number().int(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const AgentWhoamiResponse = z.object({
  agent_id: z.string(),
  name: z.string(),
  grants: z.array(z.object({ scope_type: GrantScope, scope_id: z.string(), permission: Permission })),
});
export type AgentWhoamiResponse = z.infer<typeof AgentWhoamiResponse>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;
