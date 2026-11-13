import { describe, expect, it } from 'vitest';
import { ClientEvent } from './index';

const sessionStarted = (code: string) => ({
  event_id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-000000000002',
  device_id: 'd1',
  client_ts: '2026-11-01T10:00:00Z',
  type: 'session_started',
  payload: {
    session_id: '00000000-0000-4000-8000-000000000003',
    bank_id: 'b',
    bank_version: 1,
    mode: 'recommended',
    size: 1,
    seed: 'x',
    plan: [{ exercise_id: 'ex1', revision: 1, bucket: 'weak', reason: { code, text: 'Ошибки в Dativ' } }],
    scheduler_version: 1,
  },
});

describe('PlanItem reason codes', () => {
  it('accepts the current agent code', () => {
    expect(ClientEvent.safeParse(sessionStarted('lumi')).success).toBe(true);
  });

  it("still accepts 'nomir' from plans written before the agent was renamed", () => {
    const event = ClientEvent.parse(sessionStarted('nomir'));
    expect(event.type === 'session_started' && event.payload.plan[0]?.reason.code).toBe('nomir');
  });

  it('rejects an unknown code', () => {
    expect(ClientEvent.safeParse(sessionStarted('someone')).success).toBe(false);
  });
});
