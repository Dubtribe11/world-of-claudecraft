// Pure evaluator for the optional mobile Assist button: given the player's live
// state and their class priority list (`src/sim/content/rotations.ts`), decide
// WHICH ability the one-tap button should fire right now.
//
// WHY A CORE. Mobile has room for five paged action buttons on a hand, which is
// not a rotation. This module turns the authored priority list into one answer a
// thumb can press, and it is the whole decision: the button is otherwise an
// ordinary action-bar slot (it reuses `action_bar_view`'s slot derivation for the
// icon, cooldown sweep and dimming) and the press is an ordinary `castAbility`
// the SERVER still validates. Nothing here can make a cast succeed that a manual
// press would not.
//
// CONTRACT
//   - DOM-free, i18n-free, allocation-light: one call per frame, no per-call
//     array/object garbage, and the result is a plain ability id (or null).
//   - The world input is a structural subset BOTH worlds mirror (own auras,
//     cooldown map, resource, combo points, the target's health and auras), so
//     the offline `Sim` and the online `ClientWorld` reach the same verdict.
//     `Entity.inCombat` is deliberately absent: it is not wired to clients, so
//     "engaged" is modelled as "a living hostile target is selected".
//   - The GCD is deliberately NOT a gate. During the global cooldown the button
//     keeps showing what will fire next (and paints the shared GCD sweep like
//     every other slot) instead of blanking, which is what makes it readable.
//   - Two answers, in order: the FIRST fully castable entry in the priority list,
//     else the LAST entry that is merely STRUCTURALLY castable (known, right
//     form, stealth satisfied). That fallback is why the button is never empty
//     mid-fight: the class filler shows through, dimmed by the shared bar view
//     when it is unaffordable or out of range, exactly like a manual slot.

import { freeCostAuraActive } from '../../../sim/combat/empower_next';
import { isActionLockingFormAuraKind } from '../../../sim/combat/forms';
import type { RotationCondition, RotationEntry } from '../../../sim/content/rotations';
import { ROTATION_PRIORITIES } from '../../../sim/content/rotations';
import type { AbilityDef, AbilityEffect, AuraKind, PlayerClass, Vec3 } from '../../../sim/types';
import { dist2d, MELEE_RANGE } from '../../../sim/types';
import { abilityStartsAutoAttack } from './attack_on_ability';

/** The ability fields the evaluator reads: a structural subset of
 *  `ResolvedAbility` (the talent-resolved cost and effects, plus the def). */
export interface AssistAbilityInput {
  def: AbilityDef;
  cost: number;
  effects: readonly AbilityEffect[];
  /** Authored stored uses (Twinstrike); undefined = 1. */
  charges?: number;
  /** Talent-added stored uses; undefined = 0. */
  bonusCharges?: number;
}

/** The aura fields the evaluator reads; a structural subset both worlds mirror. */
export interface AssistAuraInput {
  /** The id of the ability that applied it (how the sim ids a primary aura). */
  id: string;
  kind: AuraKind;
  remaining: number;
  stacks?: number;
  /** The caster's entity id. Absent/0 on an old server payload, which is treated
   *  as "unknown owner" and matched permissively rather than dropped. */
  sourceId?: number;
  empowerAbilities?: readonly string[];
}

/** The player fields the evaluator reads. */
export interface AssistPlayerInput {
  id: number;
  dead: boolean;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  comboPoints: number;
  /** Whether a `kind:'stealth'` aura is worn (derived from auras by the host, the
   *  same value the shared action-bar view already takes). */
  stealthed: boolean;
  auras: readonly AssistAuraInput[];
  cooldowns: { get(id: string): number | undefined };
  abilityCharges?: { [id: string]: { charges: number } | undefined };
  pos: Vec3;
}

/** The target fields the evaluator reads; null when nothing is selected. */
export interface AssistTargetInput {
  dead: boolean;
  hostile: boolean;
  hp: number;
  maxHp: number;
  pos: Vec3;
  auras: readonly AssistAuraInput[];
}

/** One frame's world snapshot. */
export interface AssistWorldInput {
  cls: PlayerClass;
  /** The committed spec id (`IWorld.talentSpec`), or null when the player has not
   *  chosen one. Only the `specIsAnyOf` gate reads it: the known list already
   *  resolves every spec-GATED ability on its own. */
  spec: string | null;
  /** The player's spec-resolved known list (`IWorld.known`). */
  known: readonly AssistAbilityInput[];
  player: AssistPlayerInput;
  target: AssistTargetInput | null;
}

function knownAbility(known: readonly AssistAbilityInput[], id: string): AssistAbilityInput | null {
  for (let i = 0; i < known.length; i++) {
    if (known[i].def.id === id) return known[i];
  }
  return null;
}

function auraWithId(auras: readonly AssistAuraInput[], id: string): AssistAuraInput | null {
  for (let i = 0; i < auras.length; i++) {
    if (auras[i].id === id) return auras[i];
  }
  return null;
}

function hasAuraKind(auras: readonly AssistAuraInput[], kind: AuraKind, minStacks = 1): boolean {
  for (let i = 0; i < auras.length; i++) {
    const aura = auras[i];
    if (aura.kind === kind && (aura.stacks ?? 1) >= minStacks) return true;
  }
  return false;
}

/**
 * The player's own copy of `auraId` on the target, or null. Ownership is matched
 * by `sourceId` so another player's identically-named DoT never reads as ours;
 * a payload with no source (0 / absent) is matched permissively, since dropping
 * it would make the assist re-apply a DoT that is already ticking.
 */
function ownTargetAura(
  target: AssistTargetInput,
  auraId: string,
  playerId: number,
): AssistAuraInput | null {
  for (let i = 0; i < target.auras.length; i++) {
    const aura = target.auras[i];
    if (aura.id !== auraId) continue;
    const source = aura.sourceId ?? 0;
    if (source === 0 || source === playerId) return aura;
  }
  return null;
}

function fraction(current: number, max: number): number {
  return max > 0 ? current / max : 0;
}

/** Resolved max stored uses for a charge-pool ability (1 = a plain cooldown). */
function maxCharges(ability: AssistAbilityInput): number {
  return Math.max(1 + (ability.bonusCharges ?? 0), ability.charges ?? 1);
}

/** The action-locking form aura (Bruin / Wolf / Travel) the player wears, or
 *  null. A for-loop, not `find`: this runs every frame and a predicate closure
 *  would be per-frame garbage. */
function actionLockingForm(auras: readonly AssistAuraInput[]): AssistAuraInput | null {
  for (let i = 0; i < auras.length; i++) {
    if (isActionLockingFormAuraKind(auras[i].kind)) return auras[i];
  }
  return null;
}

/**
 * Is this ability one the player COULD press at all right now? Everything the
 * ABILITY itself demands, and nothing the entry, the cooldown, the resource bar,
 * or the distance demands.
 *
 * This doubles as the fallback filter, which is why the split falls exactly here.
 * The excluded checks are the ones whose failure a dimmed slot already
 * communicates: cooldown, cost, and range all have a paint state, so letting the
 * fallback through them keeps the button showing "your filler, greyed" instead of
 * flickering blank as rage ticks or the target drifts. The checks kept here have
 * no paint state, so a fallback that ignored them would be an outright lie: an
 * Execute outside its kill window, a stealth opener out of stealth, or a Wolf
 * Form claw while standing in caster form.
 */
function structurallyCastable(ability: AssistAbilityInput, world: AssistWorldInput): boolean {
  const def = ability.def;
  const { player } = world;
  // Never castable from a single tap: passives have no cast, ground-targeted
  // spells need an aim point, and hold-to-charge spells need a hold. The content
  // gate keeps these out of the tables; this is the belt to that braces.
  if (def.passive) return false;
  if (def.targetMode === 'position') return false;
  if (def.empowerStages) return false;
  // The dodge-proc window (`Entity.overpowerUntil`) is not mirrored to clients,
  // so the assist can never know whether Overpower / Mongoose Bite would land.
  if (def.requiresDodgeProc) return false;
  if (def.requiresShield) return false;
  // The druid shapeshift lock, both ways (combat/casting_lifecycle.ts).
  const form = actionLockingForm(player.auras);
  if (def.requiresForm) {
    const need: AuraKind = def.requiresForm === 'bear' ? 'form_bear' : 'form_cat';
    if (!form || form.kind !== need) return false;
  } else if (form && !def.usableInForm) {
    return false;
  }
  if (def.requiresStealth && !player.stealthed) return false;
  if (def.requiresOutOfCombat && liveHostileTarget(world) !== null) return false;
  if (def.requiresAuraKind !== undefined) {
    if (!hasAuraKind(player.auras, def.requiresAuraKind, def.requiresAuraStacks ?? 1)) return false;
  }
  if (def.requiresTargetHpBelow !== undefined) {
    const target = liveHostileTarget(world);
    if (target === null) return false;
    if (fraction(target.hp, target.maxHp) > def.requiresTargetHpBelow) return false;
  }
  if (def.spendsCombo && player.comboPoints <= 0) return false;
  return true;
}

function liveHostileTarget(world: AssistWorldInput): AssistTargetInput | null {
  const target = world.target;
  if (target === null || target.dead || !target.hostile) return null;
  return target;
}

/**
 * Does the ability need an enemy selected? Anything the player targets, plus any
 * damage-dealing press (the AoEs that take no target but would otherwise be
 * thrown at empty ground). A friendly ability never does: the sim resolves it to
 * the current friendly target else the caster, so the buff-upkeep rungs work
 * with a hostile target selected or none at all.
 */
export function assistNeedsEnemy(ability: AssistAbilityInput): boolean {
  const def = ability.def;
  if (def.targetType === 'friendly') return false;
  return def.requiresTarget || abilityStartsAutoAttack(ability.effects);
}

function inRange(ability: AssistAbilityInput, from: Vec3, target: AssistTargetInput): boolean {
  const def = ability.def;
  const distance = dist2d(from, target.pos);
  if (distance > (def.range > 0 ? def.range : MELEE_RANGE)) return false;
  return def.minRange === undefined || distance >= def.minRange;
}

function affordable(ability: AssistAbilityInput, player: AssistPlayerInput): boolean {
  if (player.resource >= ability.cost) return true;
  return ability.cost > 0 && freeCostAuraActive(player.auras, ability.def.id);
}

function offCooldown(ability: AssistAbilityInput, player: AssistPlayerInput): boolean {
  const id = ability.def.id;
  const pool = maxCharges(ability);
  if (pool > 1) {
    const left = player.abilityCharges?.[id]?.charges ?? pool;
    return left > 0;
  }
  return (player.cooldowns.get(id) ?? 0) <= 0;
}

function conditionHolds(
  condition: RotationCondition,
  ability: AssistAbilityInput,
  world: AssistWorldInput,
): boolean {
  const { player } = world;
  switch (condition.type) {
    case 'freeCast':
      return freeCostAuraActive(player.auras, ability.def.id);
    case 'targetHpBelow': {
      const target = liveHostileTarget(world);
      return target !== null && fraction(target.hp, target.maxHp) < condition.frac;
    }
    case 'selfHpAbove':
      return fraction(player.hp, player.maxHp) > condition.frac;
    case 'resourceAtLeast':
      return player.resource >= condition.amount;
    case 'resourceFracBelow':
      return fraction(player.resource, player.maxResource) < condition.frac;
    case 'comboAtLeast':
      return player.comboPoints >= condition.points;
    case 'hasSelfAuraKind':
      return hasAuraKind(player.auras, condition.kind, condition.stacks ?? 1);
    case 'missingSelfAura':
      return auraWithId(player.auras, condition.auraId) === null;
    case 'missingSelfAuraKind':
      return !hasAuraKind(player.auras, condition.kind);
    case 'needsTargetDebuff': {
      const target = liveHostileTarget(world);
      if (target === null) return false;
      const worn = ownTargetAura(target, condition.auraId, player.id);
      if (worn === null) return true;
      if (condition.refreshBelow !== undefined && worn.remaining < condition.refreshBelow) {
        return true;
      }
      return condition.stacksBelow !== undefined && (worn.stacks ?? 1) < condition.stacksBelow;
    }
    case 'specIsAnyOf':
      return world.spec !== null && condition.specs.includes(world.spec);
    case 'hasHostileTarget':
      return liveHostileTarget(world) !== null;
  }
}

function entryEligible(
  entry: RotationEntry,
  ability: AssistAbilityInput,
  world: AssistWorldInput,
): boolean {
  const { player } = world;
  if (!entry.ignoreCooldown && !offCooldown(ability, player)) return false;
  if (!affordable(ability, player)) return false;
  if (assistNeedsEnemy(ability)) {
    const target = liveHostileTarget(world);
    if (target === null) return false;
    if (!inRange(ability, player.pos, target)) return false;
  }
  const when = entry.when;
  if (when !== undefined) {
    for (let i = 0; i < when.length; i++) {
      if (!conditionHolds(when[i], ability, world)) return false;
    }
  }
  return true;
}

/**
 * The ability id the Assist button should fire this frame, or null when the
 * class has no priority list, the player knows none of it, or the player is
 * dead. Never allocates: every helper above walks arrays in place.
 *
 * `priorities` is injectable so a test can drive a synthetic list; production
 * callers take the authored table.
 */
export function pickAssistAbility(
  world: AssistWorldInput,
  priorities: Readonly<Record<string, readonly RotationEntry[]>> = ROTATION_PRIORITIES,
): string | null {
  if (world.player.dead) return null;
  const list = priorities[world.cls];
  if (list === undefined) return null;
  let fallback: string | null = null;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const ability = knownAbility(world.known, entry.ability);
    if (ability === null) continue;
    if (!structurallyCastable(ability, world)) continue;
    fallback = entry.ability;
    if (entryEligible(entry, ability, world)) return entry.ability;
  }
  return fallback;
}
