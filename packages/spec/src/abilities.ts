/**
 * Relative ability cooldowns (seconds, before scaling). Tune these against each other; the
 * absolute ceiling is MAX_ABILITY_COOLDOWN_S. The nukes are the longest by design.
 */
const BASE = {
  flash: { name: 'Flash', cooldown: 8, duration: 0 },
  dash: { name: 'Dash attack', cooldown: 10, duration: 0 },
  smoke: { name: 'Smoke', cooldown: 12, duration: 4 },
  invisible: { name: 'Invisible', cooldown: 14, duration: 2 },
  flashbang: { name: 'Flashbang', cooldown: 15, duration: 2 },
  fire_steps: { name: 'Fire steps', cooldown: 12, duration: 4 },
  nuke1: { name: 'Nuke1', cooldown: 25, duration: 0 },
  nuke2: { name: 'Nuke2', cooldown: 25, duration: 0 },
  attack_boost: { name: 'Attack boost', cooldown: 15, duration: 5 },
  mini_arena: { name: 'Mini arena', cooldown: 18, duration: 5 },
  boomerang: { name: 'Boomerang', cooldown: 10, duration: 2 },
  rage: { name: 'Rage', cooldown: 14, duration: 5 },
  weapon_boost: { name: 'Weapon boost', cooldown: 14, duration: 6 },
  fire_ring: { name: 'Fire ring', cooldown: 14, duration: 4 },
  mushrooms: { name: 'Poisonous Mushrooms', cooldown: 14, duration: 15 },
  life_drain: { name: 'Life drain', cooldown: 18, duration: 3 },
  silence: { name: 'Silence', cooldown: 12, duration: 3 },
  hook: { name: 'Hook', cooldown: 12, duration: 2 },
  freeze: { name: 'Freeze', cooldown: 16, duration: 3 },
  shrink: { name: 'Shrink', cooldown: 14, duration: 6 },
} as const;

/** Longest cooldown any ability may have (the nukes). Everything else scales proportionally. */
export const MAX_ABILITY_COOLDOWN_S = 22;

const longest = Math.max(...Object.values(BASE).map((a) => a.cooldown));
/** scaled, rounded to the nearest 0.5 s */
const scaled = (s: number) => Math.round(((s * MAX_ABILITY_COOLDOWN_S) / longest) * 2) / 2;

/** Shared ability catalogue; durations and cooldowns are in seconds (cooldowns already scaled). */
export const ABILITIES = Object.fromEntries(
  Object.entries(BASE).map(([id, a]) => [id, { ...a, cooldown: scaled(a.cooldown) }]),
) as { readonly [K in keyof typeof BASE]: { readonly name: string; readonly cooldown: number; readonly duration: number } };
export type AbilityId = keyof typeof ABILITIES;
export const isAbilityId = (id: string): id is AbilityId => Object.hasOwn(BASE, id);
export interface StatusEffect { until: number; dps?: number; source?: string }
/** Unix seconds, always authored using the server clock. */
export type FighterEffects = Partial<Record<AbilityId | 'poison' | 'burn' | 'silenced' | 'frozen', StatusEffect>>;
export interface AbilityObjectData {
  kind: 'blind' | 'freeze' | 'smoke' | 'wall' | 'fire' | 'ring' | 'mushroom' | 'drain' | 'bomb' | 'boomerang' | 'hook' | 'silence';
  radius: number;
  start: number;
  until: number;
  vx?: number; vy?: number;
  originX?: number; originY?: number;
  hits?: string[];
  returning?: boolean;
  /** Presentation only: opponents actually damaged by drain on the latest tick. */
  targets?: { id: string; x: number; y: number }[];
}

/** Gameplay tuning shared by simulation and presentation. Fractions use maximum HP. */
export const ABILITY_TUNING = {
  charges: 2,
  travelDistance: 3,
  dashDamageFraction: 0.12,
  knockbackDistance: 2,
  smokeRadius: 2,
  wallHalfSize: 3,
  mushroomRadius: 0.55,
  poisonDps: 125,
  poisonSeconds: 5,
  ringRadius: 2,
  ringHalfWidth: 0.45,
  drainRadius: 3,
  drainDps: 200,
  freezeHalfSize: 1,
  freezeDistance: 2,
  projectileRadius: 0.3,
  projectileSpeed: 8,
  projectileSeconds: 2,
  boomerangReturnAfter: 0.5,
  blastRadius: 1.6,
  blastGridSpacing: 2,
  /** per victim per activation (a victim takes at most one blast from each nuke) */
  blastDamage: 200,
  blastWindup: 0.6,
  blastSweepSeconds: 3,
  blastVisibleSeconds: 0.5,
  attackDamageMultiplier: 1.4,
  attackHealthCostFraction: 0.1,
  attackSpeedMultiplier: 1.4,
  weaponScale: 1.6,
  shrinkScale: 0.5,
  firePatchRadius: 0.65,
  firePatchSeconds: 3,
  firePatchSpacing: 0.55,
  burnSeconds: 2,
} as const;

/** Disjoint pools let the existing player ability field retain a preferred play style. */
export const ABILITY_STYLES = {
  mobility: { name: 'Mobility', icon: '↗', description: 'Close the gap, reposition, and leave enemies behind.', abilities: ['flash', 'dash', 'fire_steps'] },
  power: { name: 'Power', icon: '✦', description: 'Hit harder with explosive attacks and weapon boosts.', abilities: ['nuke1', 'nuke2', 'attack_boost', 'boomerang', 'rage', 'weapon_boost', 'fire_ring'] },
  control: { name: 'Control', icon: '◎', description: 'Trap, interrupt, and pull opponents into your reach.', abilities: ['flashbang', 'mini_arena', 'mushrooms', 'silence', 'hook', 'freeze'] },
  survival: { name: 'Survival', icon: '◇', description: 'Stay alive with concealment, healing, and evasive tricks.', abilities: ['smoke', 'invisible', 'life_drain', 'shrink'] },
} as const satisfies Record<string, { name: string; icon: string; description: string; abilities: readonly AbilityId[] }>;
export type AbilityStyle = keyof typeof ABILITY_STYLES;
export function abilityStyle(id: string): AbilityStyle {
  return (Object.keys(ABILITY_STYLES) as AbilityStyle[]).find(style =>
    (ABILITY_STYLES[style].abilities as readonly string[]).includes(id)) ?? 'mobility';
}
/** Caller supplies server-seeded randomness; roll once at reveal, never on a UI render. */
export function rollAbility(selected: string, random: () => number): AbilityId {
  const pool = ABILITY_STYLES[abilityStyle(selected)].abilities;
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))]!;
}
export const ABILITY_DESCRIPTIONS: Record<AbilityId, string> = {
  flash: 'Leap forward in your movement direction to escape or close the gap.',
  dash: 'Dash forward, damaging and knocking back opponents along your path.',
  smoke: 'Create a smoke cloud for 4 seconds that prevents enemies from targeting fighters inside. You can still take damage.',
  invisible: 'Become invisible and immune to damage for 2 seconds.',
  flashbang: 'Flash the arena to briefly obscure opponents’ view for 2 seconds.',
  fire_steps: 'Leave burning footprints behind you for 4 seconds. Enemies who cross them catch fire.',
  nuke1: 'Send a wave of explosions outward from your position across the arena. Watch for the brief wind-up.',
  nuke2: 'Sweep the arena with a line of explosions after a brief wind-up.',
  attack_boost: 'Trade some health for stronger attacks for 5 seconds. Use carefully when your health is low.',
  mini_arena: 'Raise temporary walls around your position for 5 seconds, trapping nearby fighters inside.',
  boomerang: 'Throw a projectile forward that returns to you and can hit opponents on both passes.',
  rage: 'Attack faster for 5 seconds.',
  weapon_boost: 'Enlarge your weapon and extend its attack reach for 6 seconds.',
  fire_ring: 'Surround yourself with a moving ring of fire for 4 seconds. Enemies touching its edge burn.',
  mushrooms: 'Plant three poisonous traps beside you. They last up to 15 seconds and poison enemies who touch them.',
  life_drain: 'Drain nearby enemies for 3 seconds, restoring health equal to the damage you deal.',
  silence: 'Fire a projectile that blocks the first opponent’s attacks and abilities for 3 seconds.',
  hook: 'Launch a hook that pulls the first opponent it hits toward you.',
  freeze: 'Freeze opponents in a small area ahead of you for 3 seconds, stopping movement and attacks.',
  shrink: 'Shrink for 6 seconds, making yourself a smaller target.',
};
