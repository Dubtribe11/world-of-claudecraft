// Data-as-code: the authored single-target damage PRIORITY LIST for each of the
// nine classes, plus the small declarative condition vocabulary those lists use.
//
// WHY IT LIVES HERE. This is class-dynamics DATA, authored against the kits in
// `classes.ts` and meant to be read side by side with them: when a kit changes,
// its priority list is the sibling file that has to change too. It is NOT engine
// behavior (no sim system reads it, so `data.ts` does not spread it) and it is
// NOT balance: every entry names an ability the player already knows, and the
// server still validates and resolves the cast exactly as if the player had
// pressed the ability's own button. The evaluator lives client-side in
// `src/ui/hud/action_bar/assist_rotation_core.ts`; it is host-agnostic, so the
// headless env could read the same table if it ever wants a scripted baseline.
//
// WHAT A LIST IS. An ORDERED list, highest priority first. The evaluator walks
// it top-down and takes the FIRST entry that is currently castable (known, off
// cooldown, affordable, in range, conditions met). Because `abilitiesKnownAt`
// already filters the known list by CHOSEN SPEC, one list per class covers every
// spec: an arms warrior never knows `red_harvest`, so the fury entries simply do
// not match. A player who has committed to no spec keeps the full kit and gets a
// sensible blended order.
//
// AUTHORING RULES (pinned by `tests/rotations_content.test.ts`):
//   1. Every `ability` id is a real `ABILITIES` record that the owning class's
//      kit actually lists.
//   2. No entry is `passive`, `targetMode: 'position'` (needs an aim point),
//      `empowerStages` (needs a hold), or `requiresDodgeProc` (the proc window is
//      not mirrored to clients today). Those are all multi-step or unknowable
//      from one tap, so they stay off the assist.
//   3. No entry applies crowd control, a defensive cooldown, a heal, a
//      resurrection, a summon, a form/stance toggle, or a taunt. The assist does
//      damage upkeep; every judgement call stays the player's.
//   4. An entry whose only job is upkeep carries the matching `missing*`
//      condition, so the assist re-applies a buff/DoT instead of clipping it.
//   5. No two entries may fight each other into a loop (two mutually exclusive
//      buffs both gated on `missingSelfAura`): mutually exclusive families
//      (weapon imbues, seals, aspects) gate on `missingSelfAuraKind` or carry a
//      `hasHostileTarget` guard, so exactly one of them can ever be the answer.

import type { AuraKind, PlayerClass } from '../types';

/**
 * One declarative gate on a priority entry. Every variant is answerable from
 * state BOTH worlds mirror (own auras, own cooldowns/resource/combo points, the
 * current target's health and auras), so the offline `Sim` and the online
 * `ClientWorld` reach the same verdict from the same inputs.
 */
export type RotationCondition =
  /** A proc currently covers this ability's cost (Hot Streak, Sudden Death,
   *  Battle Trance, Revenge!). Scoped per ability by the sim's own predicate. */
  | { readonly type: 'freeCast' }
  /** The target is below this fraction of its maximum health. */
  | { readonly type: 'targetHpBelow'; readonly frac: number }
  /** The player is above this fraction of their maximum health (the guard on a
   *  self-damaging resource trade like Life Tap). */
  | { readonly type: 'selfHpAbove'; readonly frac: number }
  /** The player holds at least this much of their resource (a rage/energy dump). */
  | { readonly type: 'resourceAtLeast'; readonly amount: number }
  /** The player is below this fraction of their maximum resource. */
  | { readonly type: 'resourceFracBelow'; readonly frac: number }
  /** The player holds at least this many combo points (a finisher). */
  | { readonly type: 'comboAtLeast'; readonly points: number }
  /** The player wears an aura of this kind (optionally at `stacks` or more). */
  | { readonly type: 'hasSelfAuraKind'; readonly kind: AuraKind; readonly stacks?: number }
  /** The player wears NO aura with this id (buff upkeep, keyed by the applying
   *  ability's id, which is how the sim ids a primary aura). */
  | { readonly type: 'missingSelfAura'; readonly auraId: string }
  /** The player wears no aura of this kind at all (upkeep for a mutually
   *  exclusive family: weapon imbues, paladin seals). */
  | { readonly type: 'missingSelfAuraKind'; readonly kind: AuraKind }
  /** Our debuff on the current target needs (re)applying: it is absent, or it has
   *  fewer than `refreshBelow` seconds left (DoT upkeep), or it holds fewer than
   *  `stacksBelow` stacks (a stacking shred like Sunder Armor). With neither
   *  optional field it only fires when the debuff is absent outright. */
  | {
      readonly type: 'needsTargetDebuff';
      readonly auraId: string;
      readonly refreshBelow?: number;
      readonly stacksBelow?: number;
    }
  /** The player has COMMITTED to one of these specs. The known-list filter
   *  already resolves most spec differences on its own; this is for the handful
   *  of ungated base-kit presses two specs share but rank differently (every mage
   *  knows both Fireball and Frostbolt, and each wants its own school's filler). */
  | { readonly type: 'specIsAnyOf'; readonly specs: readonly string[] }
  /** A living hostile target is selected (the "am I engaged" proxy: `inCombat`
   *  is deliberately not mirrored to clients, so offensive cooldowns gate on
   *  having something to spend them on instead). */
  | { readonly type: 'hasHostileTarget' };

/** One rung of a class priority list. */
export interface RotationEntry {
  /** The ability id to cast. Must be in the owning class's authored kit. */
  readonly ability: string;
  /** All of these must hold for the entry to be eligible (implicit AND). */
  readonly when?: readonly RotationCondition[];
  /** The gating proc lets the ability be cast straight through its own running
   *  cooldown, so the cooldown check is skipped for this entry (Brain Freeze
   *  bypasses Flurry's timer: `combat/frost_mage.ts brainFreezeBypassesCooldown`).
   *  Only ever set alongside the `when` clause that reads the proc. */
  readonly ignoreCooldown?: boolean;
}

// Refresh windows (seconds left on a DoT before the assist re-applies it). Short
// enough that a re-cast never clips meaningful damage, long enough that the
// travel/cast time of the refresh lands before the drop.
const DOT_REFRESH = 2;
const DOT_REFRESH_SHORT = 1.5;

// --- warrior: rage, three specs (arms / fury / protection) -----------------
// Battle Shout first (free, party-wide, 30 min), then rage generation, the
// execute window, each spec's cooldown-limited strikes, the debuff upkeep, and
// finally the no-cooldown rage dump that spends whatever is left. Cooldowns
// above the dump is the general shape of every list here: a press that is gated
// by a timer is wasted if it sits idle, while the dump is never wasted.
// Stances are never touched: the player owns that choice.
const WARRIOR: readonly RotationEntry[] = [
  { ability: 'battle_shout', when: [{ type: 'missingSelfAura', auraId: 'battle_shout' }] },
  {
    ability: 'bloodrage',
    when: [{ type: 'hasHostileTarget' }, { type: 'resourceFracBelow', frac: 0.5 }],
  },
  // requiresTargetHpBelow lives on the ability, so the kill window needs no
  // condition here; `freeCast` covers the Sudden Death proc that makes it free.
  { ability: 'execute' },
  { ability: 'raging_gale' },
  { ability: 'slam' },
  { ability: 'thunder_clap' },
  { ability: 'whirlwind' },
  { ability: 'breachmaker' },
  // Build the armor shred to full, then stop and let Revenge have the rage.
  {
    ability: 'sunder_armor',
    when: [{ type: 'needsTargetDebuff', auraId: 'sunder_armor', stacksBelow: 5 }],
  },
  { ability: 'revenge' },
  { ability: 'red_harvest' },
  { ability: 'cleave' },
  { ability: 'heroic_strike' },
];

// --- mage: mana, three specs (fire / frost / arcane) -----------------------
// Arcane Intellect and Frost Armor are the free-standing upkeep; then each
// spec's proc spenders (Hot Streak Pyroblast, Brain Freeze Flurry, Fingers of
// Frost Ice Lance, a full Arcane Charge bar), then its hard-cast filler.
const MAGE: readonly RotationEntry[] = [
  { ability: 'arcane_intellect', when: [{ type: 'missingSelfAura', auraId: 'arcane_intellect' }] },
  { ability: 'frost_armor', when: [{ type: 'missingSelfAura', auraId: 'frost_armor' }] },
  { ability: 'combustion', when: [{ type: 'hasHostileTarget' }] },
  { ability: 'icy_veins', when: [{ type: 'hasHostileTarget' }] },
  { ability: 'perfect_moment', when: [{ type: 'hasHostileTarget' }] },
  // Hot Streak: free AND instant, so it jumps the whole list.
  { ability: 'pyroblast', when: [{ type: 'freeCast' }] },
  // Five Icicles gate Glacial Spike through requiresAuraKind on the ability.
  { ability: 'glacial_spike' },
  {
    ability: 'flurry',
    when: [{ type: 'hasSelfAuraKind', kind: 'brain_freeze' }],
    ignoreCooldown: true,
  },
  { ability: 'ice_lance', when: [{ type: 'hasSelfAuraKind', kind: 'fingers_of_frost' }] },
  { ability: 'fire_blast' },
  { ability: 'flurry' },
  {
    ability: 'arcane_missiles',
    when: [{ type: 'hasSelfAuraKind', kind: 'arcane_charge', stacks: 4 }],
  },
  { ability: 'arcane_surge' },
  // Fireball and Frostbolt are both ungated base kit, so the known list cannot
  // separate them: a committed frost mage wants the Frostbolt that feeds Fingers
  // of Frost and Brain Freeze, everyone else wants the bigger Fireball. The last
  // rung is the unconditional filler for a mage who has committed to nothing.
  { ability: 'frostbolt', when: [{ type: 'specIsAnyOf', specs: ['frost'] }] },
  { ability: 'fireball' },
  { ability: 'frostbolt' },
];

// --- rogue: energy, three specs (assassination / combat / subtlety) --------
// Poison upkeep, then Slice and Dice, then Rupture, then Eviscerate at a full
// bar, then the builders. The stealth openers sit mid-list: their own
// requiresStealth gate keeps them out of an open fight.
const ROGUE: readonly RotationEntry[] = [
  { ability: 'instant_poison', when: [{ type: 'missingSelfAuraKind', kind: 'imbue' }] },
  {
    ability: 'slice_and_dice',
    when: [
      { type: 'comboAtLeast', points: 2 },
      { type: 'missingSelfAura', auraId: 'slice_and_dice' },
    ],
  },
  {
    ability: 'rupture',
    when: [
      { type: 'comboAtLeast', points: 4 },
      { type: 'needsTargetDebuff', auraId: 'rupture', refreshBelow: DOT_REFRESH },
    ],
  },
  { ability: 'eviscerate', when: [{ type: 'comboAtLeast', points: 5 }] },
  { ability: 'garrote' },
  { ability: 'ambush' },
  {
    ability: 'adrenaline_rush',
    when: [{ type: 'hasHostileTarget' }, { type: 'resourceFracBelow', frac: 0.4 }],
  },
  { ability: 'backstab' },
  { ability: 'sinister_strike' },
];

// --- paladin: mana, three specs (holy / protection / retribution) ----------
// Blessing and Seal upkeep, then Judgement on cooldown (the seal spender), then
// the ranged/AoE damage presses. Auras are never swapped: which aura a paladin
// runs is a party-wide choice, not a rotation step.
const PALADIN: readonly RotationEntry[] = [
  {
    ability: 'blessing_of_might',
    when: [{ type: 'missingSelfAura', auraId: 'blessing_of_might' }],
  },
  { ability: 'seal_of_righteousness', when: [{ type: 'missingSelfAuraKind', kind: 'imbue' }] },
  { ability: 'exorcism' },
  { ability: 'consecration' },
  { ability: 'judgement' },
];

// --- hunter: mana, three specs (beast mastery / marksmanship / survival) ---
// Aspect of the Hawk while engaged, Serpent Sting upkeep, Rapid Fire, the
// off-GCD melee poke when something is already in melee, then the shots.
const HUNTER: readonly RotationEntry[] = [
  {
    ability: 'aspect_of_the_hawk',
    when: [{ type: 'hasHostileTarget' }, { type: 'missingSelfAura', auraId: 'aspect_of_the_hawk' }],
  },
  {
    ability: 'serpent_sting',
    when: [{ type: 'needsTargetDebuff', auraId: 'serpent_sting', refreshBelow: DOT_REFRESH_SHORT }],
  },
  { ability: 'rapid_fire', when: [{ type: 'hasHostileTarget' }] },
  { ability: 'raptor_strike' },
  { ability: 'aimed_shot' },
  { ability: 'arcane_shot' },
];

// --- priest: mana, three specs (discipline / holy / shadow) ---------------
// Fortitude upkeep, Shadow Word: Pain upkeep, Mind Blast on cooldown, Mind Flay
// as the channel, Smite as the filler. Healing is never automated.
const PRIEST: readonly RotationEntry[] = [
  {
    ability: 'power_word_fortitude',
    when: [{ type: 'missingSelfAura', auraId: 'power_word_fortitude' }],
  },
  {
    ability: 'shadow_word_pain',
    when: [
      { type: 'needsTargetDebuff', auraId: 'shadow_word_pain', refreshBelow: DOT_REFRESH_SHORT },
    ],
  },
  { ability: 'mind_blast' },
  { ability: 'mind_flay' },
  { ability: 'smite' },
];

// --- shaman: mana, three specs (elemental / enhancement / restoration) ----
// Lightning Shield and a weapon imbue (whichever the shaman is not already
// running: the gate is the imbue KIND, so a rockbiter enhancement shaman is
// left alone), Flame Shock upkeep, then the shocks and Lightning Bolt.
const SHAMAN: readonly RotationEntry[] = [
  { ability: 'lightning_shield', when: [{ type: 'missingSelfAura', auraId: 'lightning_shield' }] },
  { ability: 'flametongue_weapon', when: [{ type: 'missingSelfAuraKind', kind: 'imbue' }] },
  {
    ability: 'flame_shock',
    when: [{ type: 'needsTargetDebuff', auraId: 'flame_shock', refreshBelow: DOT_REFRESH_SHORT }],
  },
  { ability: 'earth_shock' },
  { ability: 'lightning_bolt' },
];

// --- warlock: mana, three specs (affliction / demonology / destruction) ----
// Demon Skin, then the three DoTs in descending damage-per-cast order, Life Tap
// when mana runs dry and health can pay for it, Shadowburn on cooldown, then
// Shadow Bolt. Pet summons are never automated (a five-second cast the player
// should choose) and Fear/Drain are the player's call.
const WARLOCK: readonly RotationEntry[] = [
  { ability: 'demon_skin', when: [{ type: 'missingSelfAura', auraId: 'demon_skin' }] },
  {
    ability: 'immolate',
    when: [{ type: 'needsTargetDebuff', auraId: 'immolate', refreshBelow: DOT_REFRESH_SHORT }],
  },
  {
    ability: 'corruption',
    when: [{ type: 'needsTargetDebuff', auraId: 'corruption', refreshBelow: DOT_REFRESH_SHORT }],
  },
  {
    ability: 'curse_of_agony',
    when: [{ type: 'needsTargetDebuff', auraId: 'curse_of_agony', refreshBelow: DOT_REFRESH }],
  },
  {
    ability: 'life_tap',
    when: [
      { type: 'resourceFracBelow', frac: 0.25 },
      { type: 'selfHpAbove', frac: 0.5 },
    ],
  },
  { ability: 'shadowburn' },
  { ability: 'shadow_bolt' },
];

// --- druid: mana / rage (Bruin) / energy (Wolf), three specs --------------
// One list spans all three forms because `requiresForm` gates each kit and the
// shapeshift lock rules out the caster kit while shifted, so the evaluator can
// only ever reach the abilities the druid's CURRENT form allows. Form toggles
// themselves are never automated.
const DRUID: readonly RotationEntry[] = [
  { ability: 'mark_of_the_wild', when: [{ type: 'missingSelfAura', auraId: 'mark_of_the_wild' }] },
  { ability: 'tigers_fury', when: [{ type: 'hasHostileTarget' }] },
  {
    ability: 'rip',
    when: [
      { type: 'comboAtLeast', points: 4 },
      { type: 'needsTargetDebuff', auraId: 'rip', refreshBelow: DOT_REFRESH },
    ],
  },
  { ability: 'ferocious_bite', when: [{ type: 'comboAtLeast', points: 5 }] },
  { ability: 'rake' },
  {
    ability: 'moonfire',
    when: [{ type: 'needsTargetDebuff', auraId: 'moonfire', refreshBelow: DOT_REFRESH_SHORT }],
  },
  {
    ability: 'insect_swarm',
    when: [{ type: 'needsTargetDebuff', auraId: 'insect_swarm', refreshBelow: DOT_REFRESH_SHORT }],
  },
  { ability: 'faerie_fire', when: [{ type: 'needsTargetDebuff', auraId: 'faerie_fire' }] },
  { ability: 'starfire' },
  { ability: 'claw' },
  { ability: 'maul' },
  { ability: 'swipe' },
  { ability: 'wrath' },
];

/**
 * The authored priority list per class, highest priority first. Consumed by the
 * client assist evaluator; nothing in `src/sim/` reads it.
 */
export const ROTATION_PRIORITIES: Readonly<Record<PlayerClass, readonly RotationEntry[]>> = {
  warrior: WARRIOR,
  mage: MAGE,
  rogue: ROGUE,
  paladin: PALADIN,
  hunter: HUNTER,
  priest: PRIEST,
  shaman: SHAMAN,
  warlock: WARLOCK,
  druid: DRUID,
};

/** The priority list for one class (empty for an unrecognized class id). */
export function rotationPriorityFor(cls: PlayerClass): readonly RotationEntry[] {
  return ROTATION_PRIORITIES[cls] ?? [];
}
