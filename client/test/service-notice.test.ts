import { describe, expect, it } from 'vitest';
import { describeService } from '../src/ui/service-notice';

const row = (service: string, provider: string, issue: string) =>
  ({ service, provider, issue, detail: '', at: { toDate: () => new Date(0) } });

describe('host service notice copy', () => {
  it('explains the problem, what players get meanwhile, and the fix', () => {
    const d = describeService(row('weapon_art', 'Gemini', 'credits'), 3 * 60_000);
    expect(d.headline).toBe('Weapon art (Gemini): out of credits');
    expect(d.meanwhile).toBe('Until then, players see their own doodles.');
    expect(d.fix).toBe('Add credits to the Gemini account.');
    expect(d.when).toBe('3 min ago');
  });
  it('points an unreachable agent at its tunnel URL', () => {
    expect(describeService(row('weapon_design', 'Weapon Smith agent', 'unreachable')).fix).toContain('AGENT_URL');
  });
});
