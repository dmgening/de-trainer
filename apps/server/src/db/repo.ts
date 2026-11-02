import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { GrantScope, Permission } from '@de-trainer/core';
import type { Db } from './client';
import { agentGrants, agents, bankMembers, banks, users } from './schema';

const now = () => new Date().toISOString();
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function findActiveUserByEmail(db: Db, email: string) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.email, normalizeEmail(email)), eq(users.status, 'active')))
    .get();
}

export function listUserBanks(db: Db, userId: string) {
  return db
    .select({ bankId: banks.bankId, title: banks.title, role: bankMembers.role })
    .from(bankMembers)
    .innerJoin(banks, eq(banks.bankId, bankMembers.bankId))
    .where(eq(bankMembers.userId, userId))
    .all();
}

export function findActiveAgentByClientId(db: Db, clientId: string) {
  return db
    .select()
    .from(agents)
    .where(and(eq(agents.accessClientId, clientId), eq(agents.status, 'active')))
    .get();
}

export function listAgentGrants(db: Db, agentId: string) {
  return db
    .select({ scopeType: agentGrants.scopeType, scopeId: agentGrants.scopeId, permission: agentGrants.permission })
    .from(agentGrants)
    .where(eq(agentGrants.agentId, agentId))
    .all() as { scopeType: GrantScope; scopeId: string; permission: Permission }[];
}

// Admin operations (CLI and dev seed). Idempotent where re-running is expected.

export function upsertBank(db: Db, input: { bankId: string; title: string; audience: 'owner' | 'demo' }) {
  db.insert(banks)
    .values({ ...input, createdAt: now() })
    .onConflictDoUpdate({ target: banks.bankId, set: { title: input.title, audience: input.audience } })
    .run();
}

export function addUser(db: Db, input: { email: string; displayName: string }) {
  const email = normalizeEmail(input.email);
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return existing;
  const row = { userId: randomUUID(), email, displayName: input.displayName, status: 'active' as const, createdAt: now() };
  db.insert(users).values(row).run();
  return row;
}

export function setUserStatus(db: Db, email: string, status: 'active' | 'disabled') {
  return db.update(users).set({ status }).where(eq(users.email, normalizeEmail(email))).run().changes;
}

export function listUsers(db: Db) {
  return db.select().from(users).all();
}

export function addBankMember(db: Db, bankId: string, userId: string, role: 'owner' | 'learner' = 'learner') {
  db.insert(bankMembers).values({ bankId, userId, role }).onConflictDoUpdate({ target: [bankMembers.bankId, bankMembers.userId], set: { role } }).run();
}

export function addAgent(db: Db, input: { name: string; accessClientId: string }) {
  const existing = db.select().from(agents).where(eq(agents.name, input.name)).get();
  if (existing) return existing;
  const row = { agentId: randomUUID(), ...input, status: 'active' as const, createdAt: now() };
  db.insert(agents).values(row).run();
  return row;
}

export function findAgentByName(db: Db, name: string) {
  return db.select().from(agents).where(eq(agents.name, name)).get();
}

export function setAgentStatus(db: Db, name: string, status: 'active' | 'revoked') {
  return db.update(agents).set({ status }).where(eq(agents.name, name)).run().changes;
}

export function grantAgent(db: Db, agentId: string, scopeType: GrantScope, scopeId: string, permissions: Permission[]) {
  for (const permission of permissions) {
    db.insert(agentGrants).values({ agentId, scopeType, scopeId, permission }).onConflictDoNothing().run();
  }
}
