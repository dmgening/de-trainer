import { parseArgs } from 'node:util';
import { Permission } from '@de-trainer/core';
import { loadDevAuth } from './auth/dev-auth';
import { DEV_AGENT_AUDIENCE, DEV_USER_AUDIENCE, loadConfig } from './config';
import { openDb } from './db/client';
import {
  addAgent,
  addBankMember,
  addUser,
  findActiveUserByEmail,
  findAgentByName,
  grantAgent,
  listUsers,
  setAgentStatus,
  setUserStatus,
  upsertBank,
} from './db/repo';

const USAGE = `Usage: admin <command> [options]

  bank:add     --id <bank_id> --title <title> [--audience owner|demo]
  user:add     --email <email> --name <display name> [--bank <bank_id>]
  user:disable --email <email>
  user:enable  --email <email>
  user:list
  agent:add    --name <name> --client-id <Access service token Client ID>
  agent:grant  --name <name> (--user <email> | --bank <bank_id>) --perm <p1,p2,...>
  agent:revoke --name <name>
  dev:token    (--email <email> | --client-id <id>)   outside prod only

Permissions: ${Permission.options.join(', ')}`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    title: { type: 'string' },
    audience: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    bank: { type: 'string' },
    user: { type: 'string' },
    perm: { type: 'string' },
    'client-id': { type: 'string' },
  },
});

function need(key: keyof typeof values): string {
  const v = values[key];
  if (typeof v !== 'string' || v === '') fail(`--${key} is required`);
  return v;
}

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

const config = loadConfig();
const { db, sqlite } = openDb(config.databasePath);

try {
  switch (positionals[0]) {
    case 'bank:add': {
      const audience = values.audience ?? 'owner';
      if (audience !== 'owner' && audience !== 'demo') fail('--audience must be owner or demo');
      upsertBank(db, { bankId: need('id'), title: need('title'), audience });
      console.log(`bank ${values.id} ready`);
      break;
    }
    case 'user:add': {
      const user = addUser(db, { email: need('email'), displayName: need('name') });
      if (values.bank) addBankMember(db, values.bank, user.userId);
      console.log(`user ${user.email} → ${user.userId}${values.bank ? `, member of ${values.bank}` : ''}`);
      break;
    }
    case 'user:disable':
    case 'user:enable': {
      const changed = setUserStatus(db, need('email'), positionals[0] === 'user:enable' ? 'active' : 'disabled');
      console.log(changed ? 'done' : 'no such user');
      break;
    }
    case 'user:list':
      for (const u of listUsers(db)) console.log(`${u.userId}  ${u.status.padEnd(8)}  ${u.email}  ${u.displayName}`);
      break;
    case 'agent:add': {
      const agent = addAgent(db, { name: need('name'), accessClientId: need('client-id') });
      console.log(`agent ${agent.name} → ${agent.agentId}`);
      break;
    }
    case 'agent:grant': {
      const agent = findAgentByName(db, need('name'));
      if (!agent) fail('no such agent');
      const perms = need('perm').split(',').map((p) => Permission.parse(p.trim()));
      if (values.user) {
        const user = findActiveUserByEmail(db, values.user);
        if (!user) fail('no such active user');
        grantAgent(db, agent.agentId, 'user', user.userId, perms);
      } else if (values.bank) {
        grantAgent(db, agent.agentId, 'bank', values.bank, perms);
      } else {
        fail('--user or --bank is required');
      }
      console.log('granted');
      break;
    }
    case 'agent:revoke':
      console.log(setAgentStatus(db, need('name'), 'revoked') ? 'revoked' : 'no such agent');
      break;
    case 'dev:token': {
      if (config.env === 'prod') fail('dev:token is not available in prod');
      const dev = await loadDevAuth(config.dataDir);
      const token = values['client-id']
        ? await dev.mint({ common_name: values['client-id'] }, DEV_AGENT_AUDIENCE)
        : await dev.mint({ email: need('email') }, DEV_USER_AUDIENCE);
      console.log(token);
      break;
    }
    default:
      fail(positionals[0] ? `unknown command ${positionals[0]}` : 'command is required');
  }
} finally {
  sqlite.close();
}
