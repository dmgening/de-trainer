import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export function openDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type Db = ReturnType<typeof openDb>['db'];

export function runMigrations(db: Db, migrationsDir: string): void {
  migrate(db, { migrationsFolder: migrationsDir });
}
