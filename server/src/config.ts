// External service configuration. Credentials and game provider selection are private DB values.

/**
 * Which provider answers gen_spec. ASI:One (Fetch.ai) is the only LLM provider; validation,
 * balance and fallbacks don't care where the JSON came from.
 * 'agent' uses the Weapon Smith uAgent in agents/weapon_smith/.
 */
export type SpecProvider = 'asi1' | 'agent';
// Default for the offline prompt lab only. The game opts in via private SPEC_PROVIDER=asi1 or agent.
export const SPEC_PROVIDER: SpecProvider = 'asi1';

export const MODELS = {
  /** gen_spec via ASI:One. Only `asi1` accepts images (not asi1-mini / asi1-ultra). */
  specAsi1: 'asi1',
  /** gen_sprite via xAI image editing (~$0.02, ~8 s, ~100 KB JPEG at 1024²) */
  sprite: 'grok-imagine-image',
  announcement: 'eleven_flash_v2_5',
} as const;

export const ENDPOINTS = {
  /** OpenAI-compatible chat completions */
  asi1: 'https://api.asi1.ai/v1/chat/completions',
  /** xAI image edits (input image + prompt → image) */
  xaiImageEdit: 'https://api.x.ai/v1/images/edits',
  elevenSfx: 'https://api.elevenlabs.io/v1/sound-generation',
  /** ElevenLabs text-to-speech (commentator + per-phone weapon announcement) */
  elevenTts: (voiceId: string, format = 'mp3_44100_64') =>
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${format}`,
} as const;

export const TIMEOUT_MS = {
  spec: 12_000,
  sprite: 30_000,
  sfx: 30_000,
  announcement: 12_000,
} as const;

/** Battle commentator (backlog — see README "Commentator"). Off until it's built. */
export const COMMENTARY = {
  enabled: true,
  /** ElevenLabs premade "Adam": deep American male, brash and confident. Swap any time. */
  voiceId: 'pNInz6obpgDQGcFmaJgB',
  /** fastest ElevenLabs TTS model (~0.4 s for a short line) */
  ttsModel: 'eleven_flash_v2_5',
  /** ASI:One text model for writing the line (no image needed, so the fast one) */
  lineModel: 'asi1-mini',
  /** cost guards, per room per round */
  maxLinesPerRound: 16,
  minGapS: 4,
  timeoutMs: 7000,
} as const;

/** Keys expected in the private `secrets` table (set via set_secret). */
export const SECRET_KEYS = [
  'SPEC_PROVIDER',
  'AGENT_URL',
  'AGENT_SHARED_SECRET',
  'ASI_ONE_API_KEY',
  'XAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'S3_BUCKET',
  'ASSET_BASE_URL',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
