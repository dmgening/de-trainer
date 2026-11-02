import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ExportFile, Permission, type StoredEvent } from '@de-trainer/core';
import { loadDevAuth } from './auth/dev-auth';
import { DEV_AGENT_AUDIENCE, DEV_USER_AUDIENCE, loadConfig } from './config';
import { ContentError, createContentService, sha256 } from './content/service';
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
import { buildExport } from './export';
import { createLearnerService } from './learner/service';

const USAGE = `Usage: admin <command> [options]

  bank:add     --id <bank_id> --title <title> [--audience owner|demo]
  user:add     --email <email> --name <display name> [--bank <bank_id> [--role owner|learner]]
  user:disable --email <email>
  user:enable  --email <email>
  user:list
  agent:add    --name <name> --client-id <Access service token Client ID>
  agent:grant  --name <name> (--user <email> | --bank <bank_id>) --perm <p1,p2,...>
  agent:revoke --name <name>
  media:put    --bank <bank_id> --file <image>          upload an image for packages
  package:publish --bank <bank_id> --file <package.json>  manual import, same checks as the API
  export       --email <email> [--file <out.json>]      full learner export
  restore      --email <email> --file <export.json>     import an export's log into this user
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
    role: { type: 'string' },
    file: { type: 'string' },
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
const content = createContentService(db, config.dataDir);
const learner = createLearnerService(db);

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
      const role = values.role ?? 'learner';
      if (role !== 'owner' && role !== 'learner') fail('--role must be owner or learner');
      if (values.bank) addBankMember(db, values.bank, user.userId, role);
      console.log(`user ${user.email} → ${user.userId}${values.bank ? `, ${role} of ${values.bank}` : ''}`);
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
    case 'media:put': {
      const buf = readFileSync(need('file'));
      console.log(JSON.stringify(content.putMedia(need('bank'), sha256(buf), buf)));
      break;
    }
    case 'package:publish': {
      const result = content.publish(need('bank'), JSON.parse(readFileSync(need('file'), 'utf8')), 'admin');
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'export': {
      const user = findActiveUserByEmail(db, need('email'));
      if (!user) fail('no such active user');
      const out = JSON.stringify(buildExport({ db, content, learner }, user));
      if (values.file) writeFileSync(values.file, out, { mode: 0o600 });
      else console.log(out);
      break;
    }
    case 'restore': {
      const user = findActiveUserByEmail(db, need('email'));
      if (!user) fail('no such active user');
      const file = ExportFile.parse(JSON.parse(readFileSync(need('file'), 'utf8')));
      const result = learner.restore(user.userId, file.events as StoredEvent[]);
      if (file.recommendations.set && learner.recommendations(user.userId).version === 0) {
        learner.putRecommendations(user.userId, file.recommendations.set, 'admin:restore');
      }
      if (file.scheduler_config.version > 0 && learner.schedulerConfig(user.userId).version === 0) {
        learner.putSchedulerConfig(user.userId, file.scheduler_config.config, 'admin:restore');
      }
      console.log(`restored ${result.imported} events, ${result.duplicates} already present`);
      break;
    }
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
} catch (err) {
  if (err instanceof ContentError) {
    console.error(`${err.code}: ${err.message}`);
    for (const i of err.issues ?? []) console.error(`  ${i.path}: ${i.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  sqlite.close();
}
