import { schema, table, t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';

// Table definitions. Column names are camelCase here; SpacetimeDB's default case
// policy exposes them as snake_case in SQL (e.g. `room_code`) and camelCase in the
// generated client bindings.
//
// JSON-in-a-string columns (spec, effects, strokes, features) are deliberate: their
// shapes are owned by packages/spec and evolve faster than the table schema.

export const room = table(
  { name: 'room', public: true },
  {
    code: t.string().primaryKey(),
    /** creator — the shared screen. Only it may start rounds. */
    host: t.identity(),
    phase: t.string(), // Phase from @doodle/spec
    phaseStartedAt: t.timestamp(),
    phaseEndsAt: t.timestamp(),
    round: t.u32(),
    seed: t.u32(),
    arenaR: t.f32(),
    stormX: t.f32(),
    stormY: t.f32(),
    stormR: t.f32(),
    /** hex identity of the winner, '' until Results */
    winner: t.string(),
  },
);

export const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    roomCode: t.string().index('btree'),
    name: t.string(),
    colorSlot: t.u8(),
    marker: t.string(),
    alive: t.bool(),
    connected: t.bool(),
    /** normalized 0–1 drop position on the mini-arena; -1 = not chosen */
    dropX: t.f32(),
    dropY: t.f32(),
    /** 1 = winner, 0 = not placed yet */
    placement: t.u8(),
    // defaults let existing databases migrate in place (columns added after first publish)
    abilityId: t.string().default('flash'),
    /** Actual damage dealt to opponents this round, including abilities and status effects. */
    totalDamage: t.f64().default(0),
  },
);

/** Private: raw strokes + PNG never leave the server except via procedures. */
export const drawing = table(
  { name: 'drawing' },
  {
    player: t.identity().primaryKey(),
    roomCode: t.string().index('btree'),
    strokes: t.string(), // JSON Drawing
    png: t.byteArray(),
    features: t.string(), // JSON DrawingFeatures
  },
);

/**
 * Public copy of just the doodle PNG. The shared screen needs it for the Reveal and as the
 * sprite fallback (raw drawing + outline/glow); strokes + features stay private in `drawing`.
 */
export const doodle = table(
  { name: 'doodle', public: true },
  {
    player: t.identity().primaryKey(),
    roomCode: t.string().index('btree'),
    png: t.byteArray(),
  },
);

export const weapon = table(
  { name: 'weapon', public: true },
  {
    player: t.identity().primaryKey(),
    roomCode: t.string().index('btree'),
    /** JSON StoredWeapon ({ spec, stats }) — '' while pending */
    spec: t.string(),
    spriteUrl: t.string(),
    sfxUrl: t.string(),
    status: t.string(), // WeaponStatus
  },
);

export const fighter = table(
  { name: 'fighter', public: true },
  {
    player: t.identity().primaryKey(),
    roomCode: t.string().index('btree'),
    x: t.f32(),
    y: t.f32(),
    facing: t.f32(), // radians
    hp: t.f32(),
    cooldownReadyAt: t.timestamp(),
    /** last attack start, drives the screen's attack animation */
    lastAttackAt: t.timestamp(),
    /** JSON { burn?: {dps, until}, slow?: {...}, ... } */
    effects: t.string(),
    abilityId: t.string().default('flash'),
    abilityCharges: t.u8().default(2),
    abilityReadyAt: t.timestamp().default(Timestamp.UNIX_EPOCH),
  },
);

/** Persistent ability zones, traps and projectiles; payload is owned by @doodle/spec. */
export const abilityObject = table({ name: 'ability_object', public: true }, {
  id: t.u64().primaryKey().autoInc(),
  roomCode: t.string().index('btree'),
  owner: t.identity(),
  x: t.f32(), y: t.f32(),
  data: t.string(),
});

/** Private cache: a controller requests only its own spoken weapon name. */
export const weaponVoice = table(
  { name: 'weapon_voice' },
  {
    player: t.identity().primaryKey(),
    roomCode: t.string(),
    round: t.u32(),
    name: t.string(),
    audioUrl: t.string(),
    status: t.string(), // pending | ready | failed
    requestedAt: t.timestamp(),
  },
);

/** Private: latest intent per controller. */
export const input = table(
  { name: 'input' },
  {
    player: t.identity().primaryKey(),
    dx: t.f32(),
    dy: t.f32(),
    attackBuffered: t.bool(),
    abilityBuffered: t.bool().default(false),
  },
);

export const projectile = table(
  { name: 'projectile', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    owner: t.identity(),
    x: t.f32(),
    y: t.f32(),
    vx: t.f32(),
    vy: t.f32(),
    expiresAt: t.timestamp(),
    /** JSON list of hex identities already hit (for pierce) */
    hits: t.string(),
  },
);

/** One-shot visual cues (hits, deaths, slams). tick() deletes rows older than ~1 s. */
export const fxEvent = table(
  { name: 'fx_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    type: t.string(), // 'hit' (owner=attacker) | 'damage' (owner=victim) | 'death' | 'attack' | 'shockwave'
    x: t.f32(),
    y: t.f32(),
    owner: t.identity(),
    /** damage number etc. */
    value: t.f32(),
    createdAt: t.timestamp(),
  },
);

/**
 * Server-side errors and stalls, for the client debug overlay (?debug). Messages are short and
 * generic — never prompts or raw model output. tick() keeps ~10 minutes of history.
 */
export const debugEvent = table(
  { name: 'debug_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    roomCode: t.string().index('btree'),
    source: t.string(), // 'tick' | 'gen_spec' | 'gen_sfx' | 'gen_announcement' | ...
    message: t.string(),
    createdAt: t.timestamp(),
  },
);

/**
 * Latest problem per outside service (out of credits, bad key, rate limit, agent down...), for the
 * shared-screen lobby's host notice and ?debug. Cleared on the next success. Details are
 * key-redacted provider errors, never prompts or model output.
 */
export const serviceStatus = table(
  { name: 'service_status', public: true },
  {
    service: t.string().primaryKey(), // 'weapon_design' | 'weapon_art' | 'weapon_sound' | 'voice' | 'commentator'
    provider: t.string(), // 'ASI:One', 'Weapon Smith agent', 'xAI', 'Gemini', 'ElevenLabs'
    issue: t.string(), // see ServiceIssue in lib/service-status.ts
    detail: t.string(),
    at: t.timestamp(),
  },
);

/** Private: per-room commentator throttle (cost guard). */
export const commentary = table(
  { name: 'commentary' },
  {
    roomCode: t.string().primaryKey(),
    round: t.u32(),
    lines: t.u32(),
    lastAt: t.timestamp(),
  },
);

/** Private schedule table driving tick(). One global row; tick() loops over active rooms. */
export const tickSchedule = table(
  { name: 'tick_schedule' },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  },
);

/** Private key/value store for API keys. Never subscribed, never logged. */
export const secrets = table(
  { name: 'secrets' },
  {
    key: t.string().primaryKey(),
    value: t.string(),
  },
);

/** Private: identities allowed to call admin reducers (the publisher, set in init). */
export const admin = table(
  { name: 'admin' },
  {
    identity: t.identity().primaryKey(),
  },
);

/** Private per-drawing claims: concurrent/repeated calls cannot spend credits twice. */
export const generation = table({ name: 'generation' }, {
  player: t.identity().primaryKey(),
  epoch: t.string(),
  spec: t.bool(), spriteUrl: t.bool(), sfxUrl: t.bool(),
});

const spacetimedb = schema({
  generation, room, player, drawing, doodle, weapon, weaponVoice, fighter, input, projectile, abilityObject, fxEvent, debugEvent, serviceStatus, commentary, tickSchedule, secrets, admin,
});
export default spacetimedb;
