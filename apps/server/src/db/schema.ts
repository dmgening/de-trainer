import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

/** Linear history of a bank: every publication and rollback is a new version; nothing is deleted. */
export const bankVersions = sqliteTable(
  'bank_versions',
  {
    bankId: text('bank_id')
      .notNull()
      .references(() => banks.bankId),
    version: integer('version').notNull(),
    kind: text('kind', { enum: ['publish', 'rollback'] }).notNull(),
    packageId: text('package_id'),
    packageVersion: integer('package_version'),
    rollbackTo: integer('rollback_to'),
    contentHash: text('content_hash'),
    changelog: text('changelog').notNull(),
    /** BankManifest JSON: which revision of each object belongs to this version. */
    manifest: text('manifest').notNull(),
    /** Diff JSON: added, changed, retired keys. */
    diff: text('diff').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bankId, t.version] }),
    // Rollbacks have NULL package columns; SQLite treats NULLs as distinct.
    uniqueIndex('bank_versions_package').on(t.bankId, t.packageId, t.packageVersion),
  ],
);

export const bankHeads = sqliteTable('bank_heads', {
  bankId: text('bank_id')
    .primaryKey()
    .references(() => banks.bankId),
  version: integer('version').notNull(),
});

/** Immutable revisions of topics, skills, knowledge items and exercises. */
export const contentObjects = sqliteTable(
  'content_objects',
  {
    bankId: text('bank_id')
      .notNull()
      .references(() => banks.bankId),
    kind: text('kind').notNull(),
    objectId: text('object_id').notNull(),
    revision: integer('revision').notNull(),
    body: text('body').notNull(),
    contentHash: text('content_hash').notNull(),
    createdVersion: integer('created_version').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bankId, t.kind, t.objectId, t.revision] })],
);

/** Uploaded images, per bank; the bytes live in DATA_DIR/media/{sha256}. */
export const media = sqliteTable(
  'media',
  {
    bankId: text('bank_id')
      .notNull()
      .references(() => banks.bankId),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bankId, t.sha256] })],
);

/** Append-only learner log. seq orders delivery; client_ts + event_id order the learning history. */
export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.userId),
    deviceId: text('device_id').notNull(),
    type: text('type').notNull(),
    actor: text('actor').notNull(),
    clientTs: text('client_ts').notNull(),
    serverReceivedAt: text('server_received_at').notNull(),
    clockSuspect: integer('clock_suspect', { mode: 'boolean' }).notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [index('events_user_seq').on(t.userId, t.seq)],
);

/** Nomir's priorities: each PUT stores a new version of the whole set. */
export const recommendationSets = sqliteTable(
  'recommendation_sets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.version] })],
);

export const schedulerConfigs = sqliteTable(
  'scheduler_configs',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.userId),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.version] })],
);
