import { mkdirSync } from 'node:fs';
import { loadConfig } from './config';
import { openDb, runMigrations } from './db/client';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const { db, sqlite } = openDb(config.databasePath);
runMigrations(db, config.migrationsDir);
sqlite.close();
console.log(`migrations applied to ${config.databasePath}`);
