import type { GrantScope, Permission } from '@de-trainer/core';

export type AuthedUser = { userId: string; email: string; displayName: string };

export type AuthedAgent = {
  agentId: string;
  name: string;
  grants: { scopeType: GrantScope; scopeId: string; permission: Permission }[];
};

/** Root app: identity is known only after the /api or /agent middleware has run. */
export type AppEnv = { Variables: { user?: AuthedUser; agent?: AuthedAgent } };
export type UserEnv = { Variables: { user: AuthedUser } };
export type AgentEnv = { Variables: { agent: AuthedAgent } };
