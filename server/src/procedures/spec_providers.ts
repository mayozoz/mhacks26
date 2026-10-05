import { TimeDuration } from 'spacetimedb';
import { TIMEOUT_MS, type SecretKey, type SpecProvider } from '../config';
import { toBase64 } from '../lib/base64';
import type { PCtx } from './common';
import { httpError } from '../lib/service-status';
import { agentRequest, agentText, asi1Request, asi1Text, type HttpCall, type SpecRequest } from './spec_requests';

// Each provider turns (doodle PNG, features, system prompt) into raw JSON text, or throws.
// They do nothing else: validation, balance and the DB write happen in gen_spec.
// Request shapes live in spec_requests.ts (shared with scripts/prompt-lab.ts).

export interface SpecInput {
  png: Uint8Array;
  featuresJson: string;
  systemPrompt: string;
  flavor?: string;
  seed?: number;
}

interface Provider {
  secret: SecretKey;
  build(key: string, r: SpecRequest, endpoint: string): HttpCall;
  text(json: unknown): unknown;
}

export const SPEC_PROVIDERS: Record<SpecProvider, Provider> = {
  /** ASI:One (Fetch.ai), OpenAI-compatible chat completions with strict JSON-schema output. */
  agent: { secret: 'AGENT_SHARED_SECRET', build: agentRequest, text: agentText },
  asi1: { secret: 'ASI_ONE_API_KEY', build: asi1Request, text: asi1Text },
};

export function requestSpec(ctx: PCtx, provider: SpecProvider, key: string, input: SpecInput, endpoint = ''): string {
  const p = SPEC_PROVIDERS[provider];
  const call = p.build(key, { pngBase64: toBase64(input.png), featuresJson: input.featuresJson, systemPrompt: input.systemPrompt, flavor: input.flavor, seed: input.seed }, endpoint);
  const res = ctx.http.fetch(call.url, {
    method: 'POST',
    headers: call.headers,
    body: call.body,
    timeout: TimeDuration.fromMillis(TIMEOUT_MS.spec),
  });
  if (!res.ok) throw httpError(provider, res);
  const text = p.text(res.json());
  if (typeof text !== 'string') throw new Error(`${provider}: no text in response`);
  return text;
}
