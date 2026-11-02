import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 8181;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
export const AGENT_CLIENT_ID = 'nomir-e2e.access';

/** One learner per scenario, so their logs never mix. */
export const USERS = {
  training: 'training@e2e.test',
  priorities: 'priorities@e2e.test',
  flags: 'flags@e2e.test',
  offline: 'offline@e2e.test',
  devices: 'devices@e2e.test',
  logout: 'logout@e2e.test',
  update: 'update@e2e.test',
} as const;

/** Learners and their bank: the update scenario publishes into its own bank. */
export const BANK_OF: Record<keyof typeof USERS, string> = {
  training: 'dev',
  priorities: 'dev',
  flags: 'dev',
  offline: 'dev',
  devices: 'dev',
  logout: 'dev',
  update: 'e2e-update',
};
