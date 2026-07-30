// Content gate for the authored class rotation priority lists
// (src/sim/content/rotations.ts). These assertions are the AUTHORING RULES in
// that module's header, turned into failures: a kit edit that renames or retires
// an ability, or a new entry that quietly reaches for a multi-step or
// judgement-call press, reds here instead of shipping a one-tap button that
// silently does nothing (or does something the player did not ask for).

import { describe, expect, it } from 'vitest';
import type { RotationEntry } from '../src/sim/content/rotations';
import { ROTATION_PRIORITIES, rotationPriorityFor } from '../src/sim/content/rotations';
import { ABILITIES, CLASSES } from '../src/sim/data';
import type { AbilityEffect, PlayerClass } from '../src/sim/types';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

// Effect types the assist must NEVER fire, whatever else the ability does.
// Grouped by why, so a future effect type lands in the right bucket.
const NEVER_EFFECTS: ReadonlySet<AbilityEffect['type']> = new Set<AbilityEffect['type']>([
  // crowd control that BREAKS on damage: firing it mid-rotation shatters it
  // immediately, so it is never a rotation step at any priority
  'incapacitate',
  'polymorph',
  'aoeFear',
  // interrupts: spending one on the wrong cast is worse than not having it
  'interrupt',
  // healing and resurrection: not a damage rotation, and never automated
  'heal',
  'aoeHeal',
  'chainHeal',
  'hot',
  'resurrectAlly',
  'massResurrectGroup',
  'rewind',
  // defensive cooldowns the player banks for a specific moment
  'absorb',
  'aoeAllyAbsorb',
  'greaterInvisibility',
  'cleanseSelf',
  'breakControl',
  // pets and threat: setup and tanking decisions, not a rotation step
  'summonDemon',
  'tamePet',
  'dismissPet',
  'taunt',
  'aoeTaunt',
]);

// Control effects that are acceptable ONLY as a rider on a press whose point is
// damage (Glacial Spike's root, a charge's stun). None of these break on damage,
// so the rider costs the player nothing; an ability that carries one and deals
// no damage is a pure control press and stays off the assist.
const CONTROL_RIDERS: ReadonlySet<AbilityEffect['type']> = new Set<AbilityEffect['type']>([
  'root',
  'aoeRoot',
  'stun',
  'finisherStun',
  'silence',
  'slow',
]);

// What makes a press a damage press. Deliberately spelled out here rather than
// imported from the HUD's auto-attack classifier: this gate is about the content
// table's INTENT, and it must not drift when that classifier is retuned.
const DAMAGE_EFFECTS: ReadonlySet<AbilityEffect['type']> = new Set<AbilityEffect['type']>([
  'weaponDamage',
  'weaponStrike',
  'directDamage',
  'finisherDamage',
  'dot',
  'consumeDot',
  'aoeDamage',
  'chainDamage',
  'groundAoE',
  'frozenOrb',
  'empoweredCone',
  'drainTick',
  'judgement',
]);

function dealsDamage(abilityId: string): boolean {
  return ABILITIES[abilityId].effects.some((e) => DAMAGE_EFFECTS.has(e.type));
}

function entries(cls: PlayerClass): readonly RotationEntry[] {
  return rotationPriorityFor(cls);
}

describe('rotation priority content', () => {
  it('covers every class with a non-empty ordered list', () => {
    expect(Object.keys(ROTATION_PRIORITIES).sort()).toEqual([...CLASS_IDS].sort());
    for (const cls of CLASS_IDS) {
      expect(entries(cls).length, `${cls} has no rotation`).toBeGreaterThan(0);
    }
  });

  it('names only abilities the owning class actually knows', () => {
    for (const cls of CLASS_IDS) {
      const kit = new Set(CLASSES[cls].abilities);
      for (const entry of entries(cls)) {
        expect(
          ABILITIES[entry.ability],
          `${cls}: ${entry.ability} is not an ability`,
        ).toBeDefined();
        expect(kit.has(entry.ability), `${cls}: ${entry.ability} is not in the ${cls} kit`).toBe(
          true,
        );
        expect(
          ABILITIES[entry.ability].class,
          `${cls}: ${entry.ability} belongs to another class`,
        ).toBe(cls);
      }
    }
  });

  it('lists each ability at most once per class, except a proc-gated duplicate', () => {
    for (const cls of CLASS_IDS) {
      const seen = new Map<string, RotationEntry>();
      for (const entry of entries(cls)) {
        const previous = seen.get(entry.ability);
        if (previous === undefined) {
          seen.set(entry.ability, entry);
          continue;
        }
        // A second rung for the same ability is only legitimate as the
        // proc-gated fast path above its plain form (Brain Freeze Flurry), so
        // the EARLIER rung must be the conditional one.
        expect(
          previous.when,
          `${cls}: ${entry.ability} is listed twice unconditionally`,
        ).toBeDefined();
        expect(
          (previous.when ?? []).length,
          `${cls}: the first ${entry.ability} rung carries no gate`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('never reaches for a press a single tap cannot make', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of entries(cls)) {
        const def = ABILITIES[entry.ability];
        expect(def.passive ?? false, `${cls}: ${entry.ability} is passive`).toBe(false);
        expect(def.targetMode, `${cls}: ${entry.ability} needs a ground aim`).not.toBe('position');
        expect(def.empowerStages, `${cls}: ${entry.ability} needs a charge hold`).toBeUndefined();
        expect(
          def.requiresDodgeProc ?? false,
          `${cls}: ${entry.ability} needs the unmirrored dodge-proc window`,
        ).toBe(false);
        expect(
          def.requiresShield ?? false,
          `${cls}: ${entry.ability} needs a shield the client cannot confirm`,
        ).toBe(false);
      }
    }
  });

  it('never automates crowd control, defensives, heals, summons, or taunts', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of entries(cls)) {
        for (const effect of ABILITIES[entry.ability].effects) {
          expect(
            NEVER_EFFECTS.has(effect.type),
            `${cls}: ${entry.ability} applies the off-limits effect "${effect.type}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('allows a control rider only on a press whose point is damage', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of entries(cls)) {
        const riders = ABILITIES[entry.ability].effects.filter((e) => CONTROL_RIDERS.has(e.type));
        if (riders.length === 0) continue;
        expect(
          dealsDamage(entry.ability),
          `${cls}: ${entry.ability} carries the control effect "${riders[0].type}" but deals no damage, so it is a pure control press`,
        ).toBe(true);
      }
    }
  });

  it('gives every class at least one damage press to reach for', () => {
    for (const cls of CLASS_IDS) {
      const damaging = entries(cls).filter((e) => dealsDamage(e.ability));
      expect(damaging.length, `${cls} has no damage press in its rotation`).toBeGreaterThan(0);
    }
  });

  it('never toggles a form or a stance', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of entries(cls)) {
        const def = ABILITIES[entry.ability];
        expect(
          def.exclusiveGroup,
          `${cls}: ${entry.ability} is in the mutually exclusive "${def.exclusiveGroup}" group, which the player owns`,
        ).not.toBe('warrior_stance');
        expect(def.exclusiveGroup, `${cls}: ${entry.ability} swaps the paladin aura`).not.toBe(
          'paladin_aura',
        );
        for (const effect of def.effects) {
          if (effect.type !== 'selfBuff') continue;
          expect(
            effect.kind.startsWith('form_'),
            `${cls}: ${entry.ability} toggles the ${effect.kind} form`,
          ).toBe(false);
        }
      }
    }
  });

  it('gates every mutually exclusive upkeep entry so two rungs can never loop', () => {
    // Two entries that both say "cast me when my own aura is missing" while
    // REPLACING each other would flip-flop forever. The authored escape is to
    // gate such a family on the aura KIND (or an engagement guard), so at most
    // one rung in an exclusive group may use missingSelfAura.
    for (const cls of CLASS_IDS) {
      const byGroup = new Map<string, string[]>();
      for (const entry of entries(cls)) {
        const def = ABILITIES[entry.ability];
        const usesOwnAuraGate = (entry.when ?? []).some(
          (c) => c.type === 'missingSelfAura' && c.auraId === entry.ability,
        );
        if (!usesOwnAuraGate) continue;
        // Group key: the declared exclusive group, else the aura kind an imbue /
        // primary self-buff lands, which is what makes two casts replace each other.
        const key =
          def.exclusiveGroup ??
          def.effects
            .map((e) => ('kind' in e ? String(e.kind) : e.type))
            .sort()
            .join('+');
        const list = byGroup.get(key) ?? [];
        list.push(entry.ability);
        byGroup.set(key, list);
      }
      for (const [key, abilities] of byGroup) {
        expect(
          abilities.length,
          `${cls}: ${abilities.join(' and ')} both self-gate on their own aura inside "${key}"`,
        ).toBe(1);
      }
    }
  });

  it('ends every list with an unconditional filler so the button always resolves', () => {
    for (const cls of CLASS_IDS) {
      const list = entries(cls);
      const last = list[list.length - 1];
      expect(last.when, `${cls}: the filler rung ${last.ability} is conditional`).toBeUndefined();
      const def = ABILITIES[last.ability];
      expect(
        def.requiresStealth ?? false,
        `${cls}: the filler rung ${last.ability} requires stealth`,
      ).toBe(false);
      expect(
        def.requiresTargetHpBelow,
        `${cls}: the filler rung ${last.ability} only works in a kill window`,
      ).toBeUndefined();
    }
  });

  it('only marks ignoreCooldown on a proc-gated rung', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of entries(cls)) {
        if (!entry.ignoreCooldown) continue;
        const gates = entry.when ?? [];
        expect(
          gates.some((c) => c.type === 'hasSelfAuraKind' || c.type === 'freeCast'),
          `${cls}: ${entry.ability} skips its cooldown without a proc gate`,
        ).toBe(true);
      }
    }
  });

  it('returns an empty list for an unknown class id', () => {
    expect(rotationPriorityFor('sorcerer' as PlayerClass)).toEqual([]);
  });
});
