import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
});

export const banks = sqliteTable('banks', {
  bankId: text('bank_id').primaryKey(),
  title: text('title').notNull(),
  audience: text('audience', { enum: ['owner', 'demo'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const bankMembers = sqliteTable(
  'bank_members',
  {
    bankId: text('bank_id')
      .notNull()
      .references(() => banks.bankId),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId),
    role: text('role').notNull().default('learner'),
  },
  (t) => [primaryKey({ columns: [t.bankId, t.userId] })],
);

export const agents = sqliteTable('agents', {
  agentId: text('agent_id').primaryKey(),
  accessClientId: text('access_client_id').notNull().unique(),
  name: text('name').notNull().unique(),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
});

export const agentGrants = sqliteTable(
  'agent_grants',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.agentId),
    scopeType: text('scope_type', { enum: ['user', 'bank'] }).notNull(),
    scopeId: text('scope_id').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.scopeType, t.scopeId, t.permission] })],
);
