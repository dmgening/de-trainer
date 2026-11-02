import { ContentPackage } from '@de-trainer/core';
import { FIXTURE_MEDIA, ownerPackage } from '@de-trainer/fixtures';
import { readMedia } from '@de-trainer/fixtures/node';
import { DEV_AGENT_CLIENT_ID, DEV_USER_EMAIL, loadConfig } from './config';
import { createContentService } from './content/service';
import { openDb } from './db/client';
import { addAgent, addBankMember, addUser, grantAgent, upsertBank } from './db/repo';

// Idempotent local setup: a dev user owning one bank with the test package, and a dev agent standing in for Nomir.
const config = loadConfig();
if (config.env !== 'dev') throw new Error('seed-dev runs only with APP_ENV=dev');

const { db, sqlite } = openDb(config.databasePath);
upsertBank(db, { bankId: 'dev', title: 'Dev bank', audience: 'owner' });
const user = addUser(db, { email: DEV_USER_EMAIL, displayName: 'Dev' });
addBankMember(db, 'dev', user.userId, 'owner');
const agent = addAgent(db, { name: 'nomir-dev', accessClientId: DEV_AGENT_CLIENT_ID });
grantAgent(db, agent.agentId, 'user', user.userId, ['events:read', 'events:write', 'recommendations:write', 'scheduler:write']);
grantAgent(db, agent.agentId, 'bank', 'dev', ['bank:publish']);

const content = createContentService(db, config.dataDir);
for (const m of Object.values(FIXTURE_MEDIA)) content.putMedia('dev', m.sha256, readMedia(m.file));
const published = content.publish('dev', ContentPackage.parse(ownerPackage('dev')), 'seed-dev');
sqlite.close();
console.log(`dev seed ready: ${DEV_USER_EMAIL}, agent nomir-dev (${DEV_AGENT_CLIENT_ID}), bank dev v${published.version} (${published.status})`);
