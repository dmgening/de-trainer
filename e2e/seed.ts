// Fresh data for the E2E server: banks with the owner test package, one learner per scenario,
// and a Nomir stand-in whose dev token is written to DATA_DIR/agent-token.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ContentPackage } from '@de-trainer/core';
import { FIXTURE_MEDIA, ownerPackage } from '@de-trainer/fixtures';
import { readMedia } from '@de-trainer/fixtures/node';
import { loadDevAuth } from '../apps/server/src/auth/dev-auth';
import { DEV_AGENT_AUDIENCE, loadConfig } from '../apps/server/src/config';
import { createContentService } from '../apps/server/src/content/service';
import { openDb, runMigrations } from '../apps/server/src/db/client';
import { addAgent, addBankMember, addUser, grantAgent, upsertBank } from '../apps/server/src/db/repo';
import { AGENT_CLIENT_ID, BANK_OF, USERS } from './env';

const config = loadConfig();
if (config.env !== 'dev') throw new Error('The E2E seed runs with APP_ENV=dev only');
rmSync(config.dataDir, { recursive: true, force: true });
mkdirSync(config.dataDir, { recursive: true });

const { db, sqlite } = openDb(config.databasePath);
runMigrations(db, config.migrationsDir);
const content = createContentService(db, config.dataDir);
const agent = addAgent(db, { name: 'nomir-e2e', accessClientId: AGENT_CLIENT_ID });

for (const bankId of new Set(Object.values(BANK_OF))) {
  upsertBank(db, { bankId, title: `E2E ${bankId}`, audience: 'owner' });
  for (const m of Object.values(FIXTURE_MEDIA)) content.putMedia(bankId, m.sha256, readMedia(m.file));
  content.publish(bankId, ContentPackage.parse(ownerPackage(bankId)), 'e2e-seed');
  grantAgent(db, agent.agentId, 'bank', bankId, ['bank:publish']);
}
for (const [key, email] of Object.entries(USERS) as [keyof typeof USERS, string][]) {
  const user = addUser(db, { email, displayName: `E2E ${key}` });
  addBankMember(db, BANK_OF[key], user.userId, 'owner');
  grantAgent(db, agent.agentId, 'user', user.userId, ['events:read', 'events:write', 'recommendations:write', 'scheduler:write']);
}
sqlite.close();

const dev = await loadDevAuth(config.dataDir);
writeFileSync(path.join(config.dataDir, 'agent-token'), await dev.mint({ common_name: AGENT_CLIENT_ID }, DEV_AGENT_AUDIENCE));
console.log(`e2e seed ready in ${config.dataDir}`);
