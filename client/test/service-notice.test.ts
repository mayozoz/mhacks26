import { describe, expect, it } from 'vitest';
import { describeService } from '../src/ui/service-notice';

const row = (service: string, provider: string, issue: string) =>
  ({ service, provider, issue, detail: '', at: { toDate: () => new Date(0) } });

describe('host service notice copy', () => {
  it('roasts Mei, tells everyone else how to reach her, and keeps the facts', () => {
    const d = describeService(row('weapon_art', 'Gemini', 'credits'), 3 * 60_000);
    expect(d.headline).toBe("Mei, you're out of Gemini credits. Again. 💸");
    expect(d.fix).toBe('Not Mei? Text her on Discord @nyxieeeee and tell her to go feed the Gemini meter before the doodles riot.');
    expect(d.feature).toBe('Weapon art (Gemini): out of credits');
    expect(d.meanwhile).toContain('players see their own doodles');
    expect(d.when).toBe('3 min ago');
  });
  it('points an unreachable agent at its tunnel URL', () => {
    expect(describeService(row('weapon_design', 'Weapon Smith agent', 'unreachable')).fix).toContain('AGENT_URL');
  });
  it.each(['credits', 'auth', 'rate_limit', 'unconfigured', 'unreachable', 'timeout', 'provider_down', 'error'])('%s has a line', (issue) => {
    const d = describeService(row('voice', 'ElevenLabs', issue));
    expect(d.headline.startsWith('Mei, ')).toBe(true);
    expect(d.fix).toMatch(/^Not Mei\? Text her on Discord @nyxieeeee and tell her to .+\.$/);
  });
});
