import { describe, expect, it } from 'vitest';
import { MeResponse, ROUTES } from './index';

describe('MeResponse', () => {
  it('accepts a well-formed payload', () => {
    const me = MeResponse.parse({
      user_id: 'u1',
      email: 'dima@example.com',
      display_name: 'Дима',
      banks: [{ bank_id: 'main', title: 'Max/Dima B1', role: 'learner' }],
      schema_version: 1,
      scheduler_version: 1,
      checker_version: 1,
      logout_url: '/cdn-cgi/access/logout',
    });
    expect(me.banks).toHaveLength(1);
  });

  it('rejects a payload without user_id', () => {
    expect(() => MeResponse.parse({ email: 'x', display_name: 'x', banks: [], schema_version: 1 })).toThrow();
  });
});

describe('ROUTES', () => {
  it('keeps the agent API under /agent so one Access app can guard it', () => {
    expect(ROUTES.agent.startsWith('/agent/')).toBe(true);
  });
});
