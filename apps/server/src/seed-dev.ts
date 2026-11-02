import { DEV_AGENT_CLIENT_ID, DEV_USER_EMAIL, loadConfig } from './config';
import { openDb } from './db/client';
import { addAgent, addBankMember, addUser, grantAgent, upsertBank } from './db/repo';

// Idempotent local setup: a dev user with one bank and a dev agent standing in for Nomir.
const config = loadConfig();
if (config.env !== 'dev') throw new Error('seed-dev runs only with APP_ENV=dev');

const { db, sqlite } = openDb(config.databasePath);
upsertBank(db, { bankId: 'dev', title: 'Dev bank', audience: 'owner' });
const user = addUser(db, { email: DEV_USER_EMAIL, displayName: 'Dev' });
addBankMember(db, 'dev', user.userId);
const agent = addAgent(db, { name: 'nomir-dev', accessClientId: DEV_AGENT_CLIENT_ID });
grantAgent(db, agent.agentId, 'user', user.userId, ['events:read', 'events:write', 'recommendations:write', 'scheduler:write']);
grantAgent(db, agent.agentId, 'bank', 'dev', ['bank:publish']);
sqlite.close();
console.log(`dev seed ready: ${DEV_USER_EMAIL}, agent nomir-dev (${DEV_AGENT_CLIENT_ID})`);
