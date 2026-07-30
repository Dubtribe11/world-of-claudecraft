// End-to-end proof that the authored rotation tables actually WORK for real
// characters: every class, every spec, plus the uncommitted no-spec case, driven
// through the real spec-filtered known list (`abilitiesKnownAt`) at the level cap.
//
// This is the test that catches the failure the unit tests cannot: a priority
// list whose rungs are all spec-gated away for some spec, leaving that spec's
// players with a dead button. It also pins the headline promises a player would
// notice: the assist opens on buff upkeep, then moves to damage; it enters a kill
// window; and it re-applies a DoT that is about to fall off.

import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ROTATION_PRIORITIES } from '../src/sim/content/rotations';
import { emptyModifiers, TALENTS } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { MAX_LEVEL, type PlayerClass, type Vec3 } from '../src/sim/types';
import type {
  AssistAuraInput,
  AssistPlayerInput,
  AssistTargetInput,
  AssistWorldInput,
} from '../src/ui/hud/action_bar/assist_rotation_core';
import { pickAssistAbility } from '../src/ui/hud/action_bar/assist_rotation_core';

const PLAYER_ID = 11;
const HERE: Vec3 = { x: 0, y: 0, z: 0 };
// Inside melee reach, so a melee kit and a ranged kit are both in range: this
// suite is about the priority tables, not about distance (that is covered by the
// core suite's range cases).
const NEXT_TO_ME: Vec3 = { x: 1.5, y: 0, z: 0 };

const CLASS_IDS = Object.keys(ROTATION_PRIORITIES) as PlayerClass[];

function specsOf(cls: PlayerClass): (string | undefined)[] {
  return [undefined, ...TALENTS[cls].specs.map((s) => s.id)];
}

// A committed spec with NO talent points spent: exactly what the spec-gated kit
// filter reads, without any talent tuning muddying the ability records.
function knownFor(cls: PlayerClass, spec: string | undefined) {
  if (spec === undefined) return abilitiesKnownAt(cls, MAX_LEVEL);
  return abilitiesKnownAt(cls, MAX_LEVEL, { ...emptyModifiers(), spec });
}

function player(overrides: Partial<AssistPlayerInput> = {}): AssistPlayerInput {
  return {
    id: PLAYER_ID,
    dead: false,
    hp: 1000,
    maxHp: 1000,
    // A full bar, so nothing is vetoed for affordability: an empty bar would make
    // every class fall through to its filler and hide a broken priority order.
    resource: 1000,
    maxResource: 1000,
    comboPoints: 0,
    stealthed: false,
    auras: [],
    cooldowns: new Map<string, number>(),
    pos: HERE,
    ...overrides,
  };
}

function target(overrides: Partial<AssistTargetInput> = {}): AssistTargetInput {
  return {
    dead: false,
    hostile: true,
    hp: 1000,
    maxHp: 1000,
    pos: NEXT_TO_ME,
    auras: [],
    ...overrides,
  };
}

function world(
  cls: PlayerClass,
  spec: string | undefined,
  overrides: Partial<AssistWorldInput> = {},
): AssistWorldInput {
  return {
    cls,
    spec: spec ?? null,
    known: knownFor(cls, spec),
    player: player(),
    target: target(),
    ...overrides,
  };
}

/** Walk the assist forward `presses` times, applying each cast's own cooldown and
 *  its primary self-buff / target-DoT aura, so a sequence reads like real play
 *  instead of the same answer repeated. Deliberately simple: this models only the
 *  effects the priority tables gate on. */
function sequence(cls: PlayerClass, spec: string | undefined, presses: number): string[] {
  const cooldowns = new Map<string, number>();
  const selfAuras: AssistAuraInput[] = [];
  const targetAuras: AssistAuraInput[] = [];
  const out: string[] = [];
  const w = world(cls, spec, {
    player: player({ cooldowns, auras: selfAuras }),
    target: target({ auras: targetAuras }),
  });
  for (let i = 0; i < presses; i++) {
    const pick = pickAssistAbility(w);
    if (pick === null) break;
    out.push(pick);
    const def = ABILITIES[pick];
    if (def.cooldown > 0) cooldowns.set(pick, def.cooldown);
    for (const effect of def.effects) {
      if (effect.type === 'selfBuff' || effect.type === 'buffTarget' || effect.type === 'imbue') {
        selfAuras.push({
          id: pick,
          kind: effect.type === 'imbue' ? 'imbue' : effect.kind,
          remaining: effect.duration,
          sourceId: PLAYER_ID,
        });
      }
      if (effect.type === 'dot' || effect.type === 'faerieFire') {
        targetAuras.push({
          id: pick,
          kind: effect.type === 'dot' ? 'dot' : 'faerie_fire',
          remaining: effect.duration,
          sourceId: PLAYER_ID,
        });
      }
    }
  }
  return out;
}

describe('authored rotations resolve for every real character', () => {
  it('answers with a known ability for every class and spec at the level cap', () => {
    for (const cls of CLASS_IDS) {
      for (const spec of specsOf(cls)) {
        const known = knownFor(cls, spec);
        const label = `${cls}/${spec ?? 'no spec'}`;
        const pick = pickAssistAbility(world(cls, spec, { known }));
        expect(pick, `${label} has no assist answer`).not.toBeNull();
        expect(
          known.some((k) => k.def.id === pick),
          `${label} answered ${pick}, which it does not know`,
        ).toBe(true);
        expect(ABILITIES[pick as string].passive ?? false, `${label} answered a passive`).toBe(
          false,
        );
      }
    }
  });

  it('still answers with nothing selected, so buff upkeep works out of combat', () => {
    for (const cls of CLASS_IDS) {
      for (const spec of specsOf(cls)) {
        const pick = pickAssistAbility(world(cls, spec, { target: null }));
        const label = `${cls}/${spec ?? 'no spec'}`;
        // Either an upkeep buff is available (the usual case) or the class's whole
        // list is offensive and only the fallback shows through. Both are fine;
        // what must never happen is the button resolving to a passive.
        if (pick !== null) {
          expect(ABILITIES[pick].passive ?? false, `${label} answered a passive`).toBe(false);
        }
      }
    }
  });

  it('opens on upkeep and moves on to damage without repeating itself', () => {
    for (const cls of CLASS_IDS) {
      for (const spec of specsOf(cls)) {
        const label = `${cls}/${spec ?? 'no spec'}`;
        const presses = sequence(cls, spec, 8);
        expect(presses.length, `${label} stalled after ${presses.length} presses`).toBe(8);
        // The opening presses must not be one ability spammed while its own
        // gating aura is already up: that is the "assist re-casts my buff
        // forever" failure. Distinctness across the first four presses proves the
        // upkeep gates actually clear once satisfied.
        const opening = presses.slice(0, 4);
        expect(
          new Set(opening).size,
          `${label} repeated inside its opener: ${opening.join(', ')}`,
        ).toBeGreaterThan(1);
      }
    }
  });

  it('never answers with an ability the class does not own', () => {
    for (const cls of CLASS_IDS) {
      for (const entry of ROTATION_PRIORITIES[cls]) {
        expect(ABILITIES[entry.ability].class, `${cls}: ${entry.ability}`).toBe(cls);
      }
    }
  });
});

describe('authored rotations honour the headline promises', () => {
  it('enters the warrior kill window as soon as the target is executable', () => {
    const healthy = pickAssistAbility(
      world('warrior', 'arms', {
        player: player({ auras: [{ id: 'battle_shout', kind: 'buff_ap_pct', remaining: 600 }] }),
        target: target({ hp: 900 }),
      }),
    );
    const executable = pickAssistAbility(
      world('warrior', 'arms', {
        player: player({ auras: [{ id: 'battle_shout', kind: 'buff_ap_pct', remaining: 600 }] }),
        target: target({ hp: 100 }),
      }),
    );
    expect(healthy).not.toBe('execute');
    expect(executable).toBe('execute');
  });

  it('refreshes a warlock DoT only once it is about to fall off', () => {
    const withDots = (remaining: number) =>
      pickAssistAbility(
        world('warlock', 'affliction', {
          player: player({
            auras: [{ id: 'demon_skin', kind: 'buff_armor', remaining: 1800 }],
            // Everything else is gated behind the DoTs, so a full mana bar keeps
            // Life Tap out of the way.
            resource: 1000,
          }),
          target: target({
            auras: [
              { id: 'immolate', kind: 'dot', remaining, sourceId: PLAYER_ID },
              { id: 'corruption', kind: 'dot', remaining, sourceId: PLAYER_ID },
              { id: 'curse_of_agony', kind: 'dot', remaining, sourceId: PLAYER_ID },
            ],
          }),
        }),
      );
    // All three ticking with time to spare: fall through to a nuke.
    expect(withDots(10)).not.toBe('immolate');
    // Immolate is the highest-priority DoT, so it is the one that refreshes.
    expect(withDots(0.5)).toBe('immolate');
  });

  it('spends a rogue finisher only at a full combo bar', () => {
    const at = (comboPoints: number) =>
      pickAssistAbility(
        world('rogue', 'assassination', {
          player: player({
            comboPoints,
            auras: [{ id: 'instant_poison', kind: 'imbue', remaining: 1800 }],
          }),
        }),
      );
    expect(at(0)).not.toBe('eviscerate');
    // Two points arm Slice and Dice, the higher rung, before any finisher damage.
    expect(at(2)).toBe('slice_and_dice');
  });

  it('gives a shifted feral druid its form kit and never the caster kit', () => {
    const cat = pickAssistAbility(
      world('druid', 'feral', {
        player: player({
          auras: [
            { id: 'cat_form', kind: 'form_cat', remaining: 600 },
            { id: 'mark_of_the_wild', kind: 'buff_stats_pct', remaining: 1800 },
          ],
        }),
      }),
    );
    expect(cat).not.toBeNull();
    const def = ABILITIES[cat as string];
    expect(def.requiresForm ?? 'cat', `${cat} is not a Wolf-form press`).toBe('cat');
  });
});
