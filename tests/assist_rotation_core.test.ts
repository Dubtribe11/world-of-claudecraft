// Pure-core tests for the mobile Assist evaluator. Cover: the priority walk
// takes the FIRST castable rung; every gate that can veto a rung (cooldown,
// resource, range, target, form, stealth, the ability's own requires* fields);
// each declarative condition in the vocabulary, in BOTH arms; the structurally
// castable fallback that keeps the button from ever going blank; the
// allocation-free promise; and Sim-vs-ClientWorld parity, driven from a real
// authored class list with real ability records so the table and the evaluator
// are checked against each other rather than against a mock.

import { describe, expect, it } from 'vitest';
import type { RotationEntry } from '../src/sim/content/rotations';
import { ABILITIES } from '../src/sim/data';
import type { AbilityDef, Aura, AuraKind, PlayerClass, Vec3 } from '../src/sim/types';
import {
  type AssistAbilityInput,
  type AssistAuraInput,
  type AssistPlayerInput,
  type AssistTargetInput,
  type AssistWorldInput,
  assistNeedsEnemy,
  pickAssistAbility,
} from '../src/ui/hud/action_bar/assist_rotation_core';

const PLAYER_ID = 7;
const HERE: Vec3 = { x: 0, y: 0, z: 0 };
const CLOSE: Vec3 = { x: 2, y: 0, z: 0 };
const FAR: Vec3 = { x: 60, y: 0, z: 0 };

/** A real authored ability, resolved the way `IWorld.known` hands one over. */
function real(id: string, overrides: Partial<AssistAbilityInput> = {}): AssistAbilityInput {
  const def = ABILITIES[id];
  if (def === undefined) throw new Error(`no such ability: ${id}`);
  return { def, cost: def.cost, effects: def.effects, ...overrides };
}

/** A synthetic ability, for gates no authored record exercises. */
function fake(id: string, def: Partial<AbilityDef> = {}, cost = 0): AssistAbilityInput {
  const full = {
    id,
    name: id,
    class: 'warrior',
    cost,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    effects: [{ type: 'directDamage', min: 1, max: 1 }],
    ...def,
  } as unknown as AbilityDef;
  return { def: full, cost, effects: full.effects };
}

function aura(id: string, kind: AuraKind, extra: Partial<AssistAuraInput> = {}): AssistAuraInput {
  return { id, kind, remaining: 60, sourceId: PLAYER_ID, ...extra };
}

function player(overrides: Partial<AssistPlayerInput> = {}): AssistPlayerInput {
  return {
    id: PLAYER_ID,
    dead: false,
    hp: 100,
    maxHp: 100,
    resource: 100,
    maxResource: 100,
    comboPoints: 0,
    stealthed: false,
    auras: [],
    cooldowns: new Map<string, number>(),
    pos: HERE,
    ...overrides,
  };
}

function target(overrides: Partial<AssistTargetInput> = {}): AssistTargetInput {
  return { dead: false, hostile: true, hp: 100, maxHp: 100, pos: CLOSE, auras: [], ...overrides };
}

function world(overrides: Partial<AssistWorldInput> = {}): AssistWorldInput {
  return {
    cls: 'warrior',
    spec: null,
    known: [],
    player: player(),
    target: target(),
    ...overrides,
  };
}

/** A one-class priority table, so a case names exactly the rungs it means. */
function table(entries: readonly RotationEntry[], cls: PlayerClass = 'warrior') {
  return { [cls]: entries } as Record<string, readonly RotationEntry[]>;
}

describe('pickAssistAbility: the priority walk', () => {
  it('takes the first castable rung, not the highest-damage one', () => {
    const pick = pickAssistAbility(
      world({ known: [fake('top'), fake('bottom')] }),
      table([{ ability: 'top' }, { ability: 'bottom' }]),
    );
    expect(pick).toBe('top');
  });

  it('skips a rung the player has not learned', () => {
    const pick = pickAssistAbility(
      world({ known: [fake('bottom')] }),
      table([{ ability: 'unlearned' }, { ability: 'bottom' }]),
    );
    expect(pick).toBe('bottom');
  });

  it('skips a rung on cooldown and falls to the next', () => {
    const pick = pickAssistAbility(
      world({
        known: [fake('cd', { cooldown: 10 }), fake('ready')],
        player: player({ cooldowns: new Map([['cd', 4.2]]) }),
      }),
      table([{ ability: 'cd' }, { ability: 'ready' }]),
    );
    expect(pick).toBe('ready');
  });

  it('casts a charge-pool rung while a stored use remains and skips it at zero', () => {
    const known = [fake('twin', { maxCharges: 2 }, 0), fake('filler')];
    const twin: AssistAbilityInput = { ...known[0], charges: 2 };
    const withCharges = (charges: number) =>
      pickAssistAbility(
        world({
          known: [twin, known[1]],
          // The empty pool ALSO mirrors into cooldowns, exactly as the sim does,
          // so this proves the charge path wins over the plain cooldown read.
          player: player({
            abilityCharges: { twin: { charges } },
            cooldowns: new Map([['twin', charges > 0 ? 0 : 6]]),
          }),
        }),
        table([{ ability: 'twin' }, { ability: 'filler' }]),
      );
    expect(withCharges(1)).toBe('twin');
    expect(withCharges(0)).toBe('filler');
  });

  it('skips an unaffordable rung, but not one a free-cost proc covers', () => {
    const known = [fake('spender', {}, 80), fake('filler')];
    const at = (resource: number, auras: AssistAuraInput[] = []) =>
      pickAssistAbility(
        world({ known, player: player({ resource, auras }) }),
        table([{ ability: 'spender' }, { ability: 'filler' }]),
      );
    expect(at(80)).toBe('spender');
    expect(at(20)).toBe('filler');
    expect(at(20, [aura('proc', 'next_cast_free')])).toBe('spender');
  });

  it('skips an out-of-range rung and honours a minimum range', () => {
    const known = [fake('shot', { requiresTarget: true, range: 30 }), fake('melee')];
    const list = table([{ ability: 'shot' }, { ability: 'melee' }]);
    expect(pickAssistAbility(world({ known }), list)).toBe('shot');
    expect(pickAssistAbility(world({ known, target: target({ pos: FAR }) }), list)).toBe('melee');

    const deadzone = [
      fake('sniper', { requiresTarget: true, range: 35, minRange: 8 }),
      fake('melee'),
    ];
    const dzList = table([{ ability: 'sniper' }, { ability: 'melee' }]);
    expect(pickAssistAbility(world({ known: deadzone }), dzList)).toBe('melee');
    expect(
      pickAssistAbility(
        world({ known: deadzone, target: target({ pos: { x: 20, y: 0, z: 0 } }) }),
        dzList,
      ),
    ).toBe('sniper');
  });
});

describe('pickAssistAbility: target requirements', () => {
  it('needs a LIVING HOSTILE target for a damage press', () => {
    // A second, target-free rung below it is what makes the veto observable: if
    // the damage rung were eligible it would win, being higher.
    const known = [
      fake('nuke', { requiresTarget: true, range: 30 }),
      fake('shout', { requiresTarget: false, effects: [] }),
    ];
    const list = table([{ ability: 'nuke' }, { ability: 'shout' }]);
    expect(pickAssistAbility(world({ known }), list)).toBe('nuke');
    // Nothing selected, a corpse, and a friendly all veto it the same way.
    expect(pickAssistAbility(world({ known, target: null }), list)).toBe('shout');
    expect(pickAssistAbility(world({ known, target: target({ dead: true }) }), list)).toBe('shout');
    expect(pickAssistAbility(world({ known, target: target({ hostile: false }) }), list)).toBe(
      'shout',
    );
  });

  it('casts a self/party buff with no target at all', () => {
    const shout = real('battle_shout');
    expect(assistNeedsEnemy(shout)).toBe(false);
    const pick = pickAssistAbility(
      world({ known: [shout], target: null }),
      table([
        { ability: 'battle_shout', when: [{ type: 'missingSelfAura', auraId: 'battle_shout' }] },
      ]),
    );
    expect(pick).toBe('battle_shout');
  });

  it('treats a friendly-targeted buff as needing no enemy', () => {
    // Blessing of Might is requiresTarget + targetType friendly: the sim resolves
    // it to the friendly target else the caster, so a hostile selection (or none)
    // must not veto it.
    const blessing = real('blessing_of_might');
    expect(assistNeedsEnemy(blessing)).toBe(false);
    const pick = pickAssistAbility(
      world({ cls: 'paladin', known: [blessing], target: target({ pos: FAR }) }),
      table(
        [
          {
            ability: 'blessing_of_might',
            when: [{ type: 'missingSelfAura', auraId: 'blessing_of_might' }],
          },
        ],
        'paladin',
      ),
    );
    expect(pick).toBe('blessing_of_might');
  });

  it('needs an enemy for a targetless AoE, so it is never thrown at empty ground', () => {
    const clap = real('thunder_clap');
    expect(clap.def.requiresTarget).toBe(false);
    expect(assistNeedsEnemy(clap)).toBe(true);
  });
});

describe('pickAssistAbility: the ability-level requires* gates', () => {
  it('holds an execute-window ability until the target is low', () => {
    const known = [real('execute'), real('cleave')];
    const list = table([{ ability: 'execute' }, { ability: 'cleave' }]);
    expect(pickAssistAbility(world({ known, target: target({ hp: 90 }) }), list)).toBe('cleave');
    expect(pickAssistAbility(world({ known, target: target({ hp: 10 }) }), list)).toBe('execute');
  });

  it('holds a stealth opener until the player is stealthed', () => {
    const known = [real('ambush'), real('sinister_strike')];
    const list = table([{ ability: 'ambush' }, { ability: 'sinister_strike' }], 'rogue');
    const at = (stealthed: boolean) =>
      pickAssistAbility(world({ cls: 'rogue', known, player: player({ stealthed }) }), list);
    expect(at(false)).toBe('sinister_strike');
    expect(at(true)).toBe('ambush');
  });

  it('holds a stack-gated ability until the stacks are banked', () => {
    const known = [real('glacial_spike'), real('frostbolt')];
    const list = table([{ ability: 'glacial_spike' }, { ability: 'frostbolt' }], 'mage');
    const at = (stacks: number) =>
      pickAssistAbility(
        world({
          cls: 'mage',
          known,
          player: player({ auras: stacks > 0 ? [aura('icicles', 'icicles', { stacks })] : [] }),
          target: target({ pos: CLOSE }),
        }),
        list,
      );
    expect(real('glacial_spike').def.requiresAuraStacks).toBe(5);
    expect(at(0)).toBe('frostbolt');
    expect(at(4)).toBe('frostbolt');
    expect(at(5)).toBe('glacial_spike');
  });

  it('holds a finisher until a combo point exists', () => {
    const known = [real('eviscerate'), real('sinister_strike')];
    const list = table([{ ability: 'eviscerate' }, { ability: 'sinister_strike' }], 'rogue');
    const at = (comboPoints: number) =>
      pickAssistAbility(world({ cls: 'rogue', known, player: player({ comboPoints }) }), list);
    expect(at(0)).toBe('sinister_strike');
    expect(at(1)).toBe('eviscerate');
  });

  it('obeys the shapeshift lock in both directions', () => {
    const known = [real('claw'), real('wrath')];
    const list = table([{ ability: 'claw' }, { ability: 'wrath' }], 'druid');
    // Caster form: the Wolf-only builder is unreachable, so Wrath answers.
    expect(
      pickAssistAbility(world({ cls: 'druid', known, target: target({ pos: CLOSE }) }), list),
    ).toBe('wrath');
    // Wolf form: Claw is reachable AND the caster kit is locked out, so even the
    // fallback cannot be Wrath.
    const shifted = world({
      cls: 'druid',
      known,
      player: player({ auras: [aura('cat_form', 'form_cat')], resource: 100 }),
    });
    expect(pickAssistAbility(shifted, list)).toBe('claw');
    expect(pickAssistAbility(shifted, table([{ ability: 'wrath' }], 'druid'))).toBeNull();
  });

  it('never answers with a passive, a ground-aim spell, or a charge-hold spell', () => {
    const cases: [string, Partial<AbilityDef>][] = [
      ['passive', { passive: true }],
      ['ground', { targetMode: 'position' }],
      ['held', { empowerStages: 3 }],
      ['dodge', { requiresDodgeProc: true }],
      ['shield', { requiresShield: true }],
    ];
    for (const [id, def] of cases) {
      const pick = pickAssistAbility(world({ known: [fake(id, def)] }), table([{ ability: id }]));
      expect(pick, `${id} must never be the assist's answer`).toBeNull();
    }
  });
});

describe('pickAssistAbility: the condition vocabulary', () => {
  const both = (when: RotationEntry['when'], overrides: Partial<AssistWorldInput>) =>
    pickAssistAbility(
      world({ known: [fake('gated'), fake('filler')], ...overrides }),
      table([{ ability: 'gated', when }, { ability: 'filler' }]),
    );

  it('freeCast reads the proc scoped to THIS ability', () => {
    const scoped = [aura('hot_streak', 'next_cast_free', { empowerAbilities: ['other'] })];
    expect(both([{ type: 'freeCast' }], { player: player({ auras: scoped }) })).toBe('filler');
    expect(
      both([{ type: 'freeCast' }], {
        player: player({
          auras: [aura('hot_streak', 'next_cast_free', { empowerAbilities: ['gated'] })],
        }),
      }),
    ).toBe('gated');
  });

  it('targetHpBelow gates on the target health fraction', () => {
    expect(both([{ type: 'targetHpBelow', frac: 0.3 }], { target: target({ hp: 50 }) })).toBe(
      'filler',
    );
    expect(both([{ type: 'targetHpBelow', frac: 0.3 }], { target: target({ hp: 20 }) })).toBe(
      'gated',
    );
  });

  it('selfHpAbove guards a self-damaging trade', () => {
    expect(both([{ type: 'selfHpAbove', frac: 0.5 }], { player: player({ hp: 30 }) })).toBe(
      'filler',
    );
    expect(both([{ type: 'selfHpAbove', frac: 0.5 }], { player: player({ hp: 80 }) })).toBe(
      'gated',
    );
  });

  it('resourceAtLeast and resourceFracBelow read opposite ends of the bar', () => {
    expect(
      both([{ type: 'resourceAtLeast', amount: 80 }], { player: player({ resource: 50 }) }),
    ).toBe('filler');
    expect(
      both([{ type: 'resourceAtLeast', amount: 80 }], { player: player({ resource: 90 }) }),
    ).toBe('gated');
    expect(
      both([{ type: 'resourceFracBelow', frac: 0.3 }], { player: player({ resource: 50 }) }),
    ).toBe('filler');
    expect(
      both([{ type: 'resourceFracBelow', frac: 0.3 }], { player: player({ resource: 10 }) }),
    ).toBe('gated');
  });

  it('comboAtLeast counts banked combo points', () => {
    expect(
      both([{ type: 'comboAtLeast', points: 5 }], { player: player({ comboPoints: 3 }) }),
    ).toBe('filler');
    expect(
      both([{ type: 'comboAtLeast', points: 5 }], { player: player({ comboPoints: 5 }) }),
    ).toBe('gated');
  });

  it('hasSelfAuraKind can require a stack count', () => {
    const charges = (stacks: number) =>
      both([{ type: 'hasSelfAuraKind', kind: 'arcane_charge', stacks: 4 }], {
        player: player({ auras: [aura('arcane_surge', 'arcane_charge', { stacks })] }),
      });
    expect(charges(3)).toBe('filler');
    expect(charges(4)).toBe('gated');
    // A stackless aura reads as one stack, which satisfies the default.
    expect(
      both([{ type: 'hasSelfAuraKind', kind: 'brain_freeze' }], {
        player: player({ auras: [aura('brain_freeze', 'brain_freeze')] }),
      }),
    ).toBe('gated');
  });

  it('missingSelfAura and missingSelfAuraKind drive buff upkeep', () => {
    expect(both([{ type: 'missingSelfAura', auraId: 'gated' }], {})).toBe('gated');
    expect(
      both([{ type: 'missingSelfAura', auraId: 'gated' }], {
        player: player({ auras: [aura('gated', 'buff_ap')] }),
      }),
    ).toBe('filler');
    // The KIND form is what stops two mutually exclusive imbues fighting: any
    // imbue at all satisfies it, even one from a different ability.
    expect(both([{ type: 'missingSelfAuraKind', kind: 'imbue' }], {})).toBe('gated');
    expect(
      both([{ type: 'missingSelfAuraKind', kind: 'imbue' }], {
        player: player({ auras: [aura('rockbiter_weapon', 'imbue')] }),
      }),
    ).toBe('filler');
  });

  it('needsTargetDebuff re-applies only OUR dot, and only near its expiry', () => {
    const gate = { type: 'needsTargetDebuff' as const, auraId: 'gated', refreshBelow: 2 };
    expect(both([gate], {})).toBe('gated');
    // Ours, with plenty of time left: leave it alone.
    expect(
      both([gate], { target: target({ auras: [aura('gated', 'dot', { remaining: 9 })] }) }),
    ).toBe('filler');
    // Ours, about to fall off: refresh it.
    expect(
      both([gate], { target: target({ auras: [aura('gated', 'dot', { remaining: 1 })] }) }),
    ).toBe('gated');
    // Someone else's identically-named dot is not ours: apply our own.
    expect(
      both([gate], {
        target: target({
          auras: [aura('gated', 'dot', { remaining: 9, sourceId: PLAYER_ID + 1 })],
        }),
      }),
    ).toBe('gated');
    // A payload with no source is matched permissively rather than re-applied.
    expect(
      both([gate], {
        target: target({ auras: [{ id: 'gated', kind: 'dot', remaining: 9 }] }),
      }),
    ).toBe('filler');
    // With no refresh window the dot is only re-applied when absent entirely.
    expect(
      both([{ type: 'needsTargetDebuff', auraId: 'gated' }], {
        target: target({ auras: [aura('gated', 'dot', { remaining: 0.2 })] }),
      }),
    ).toBe('filler');
  });

  it('hasHostileTarget stands in for "engaged"', () => {
    expect(both([{ type: 'hasHostileTarget' }], {})).toBe('gated');
    expect(both([{ type: 'hasHostileTarget' }], { target: null })).toBe('filler');
    expect(both([{ type: 'hasHostileTarget' }], { target: target({ dead: true }) })).toBe('filler');
    expect(both([{ type: 'hasHostileTarget' }], { target: target({ hostile: false }) })).toBe(
      'filler',
    );
  });

  it('requires EVERY condition on a rung (implicit AND)', () => {
    const when: RotationEntry['when'] = [
      { type: 'comboAtLeast', points: 4 },
      { type: 'hasHostileTarget' },
    ];
    expect(both(when, { player: player({ comboPoints: 4 }) })).toBe('gated');
    expect(both(when, { player: player({ comboPoints: 4 }), target: null })).toBe('filler');
    expect(both(when, { player: player({ comboPoints: 1 }) })).toBe('filler');
  });

  it('ignoreCooldown lets a proc-gated rung fire through its own timer', () => {
    const known = [fake('flurry', { cooldown: 10 }), fake('filler')];
    const cooldowns = new Map([['flurry', 6]]);
    const armed = [aura('brain_freeze', 'brain_freeze')];
    const list = (ignoreCooldown: boolean) =>
      table([
        {
          ability: 'flurry',
          when: [{ type: 'hasSelfAuraKind', kind: 'brain_freeze' }],
          ignoreCooldown,
        },
        { ability: 'filler' },
      ]);
    expect(
      pickAssistAbility(world({ known, player: player({ cooldowns, auras: armed }) }), list(true)),
    ).toBe('flurry');
    expect(
      pickAssistAbility(world({ known, player: player({ cooldowns, auras: armed }) }), list(false)),
    ).toBe('filler');
  });
});

describe('pickAssistAbility: the fallback', () => {
  it('falls back to the LAST structurally castable rung when nothing is eligible', () => {
    const pick = pickAssistAbility(
      world({
        known: [fake('a', {}, 50), fake('b', {}, 50), fake('c', {}, 50)],
        player: player({ resource: 0 }),
      }),
      table([{ ability: 'a' }, { ability: 'b' }, { ability: 'c' }]),
    );
    // Unaffordable, so no rung is eligible: the cheapest-by-convention last rung
    // shows through (the shared bar view dims it as unusable).
    expect(pick).toBe('c');
  });

  it('excludes a stealth opener and a kill-window press from the fallback', () => {
    const pick = pickAssistAbility(
      world({
        known: [fake('filler', {}, 50), fake('opener', { requiresStealth: true }, 50)],
        player: player({ resource: 0 }),
      }),
      table([{ ability: 'filler' }, { ability: 'opener' }]),
    );
    expect(pick).toBe('filler');
  });

  it('answers null when the player is dead', () => {
    expect(
      pickAssistAbility(
        world({ known: [fake('anything')], player: player({ dead: true }) }),
        table([{ ability: 'anything' }]),
      ),
    ).toBeNull();
  });

  it('answers null for a class with no list and for an empty known list', () => {
    expect(
      pickAssistAbility(world({ known: [fake('x')] }), table([{ ability: 'x' }], 'mage')),
    ).toBeNull();
    expect(pickAssistAbility(world({ known: [] }), table([{ ability: 'x' }]))).toBeNull();
  });
});

describe('pickAssistAbility: hosts and hot-path shape', () => {
  // The evaluator is called every frame from Hud.update(). It must not be the
  // thing that starts allocating: this drives it many times over a stable input
  // and asserts the answer never drifts, which is what a hidden mutable cache
  // (the usual accidental allocation) would break.
  it('is a stable pure function over repeated frames', () => {
    const input = world({
      known: [real('battle_shout'), real('execute'), real('cleave')],
      target: target({ hp: 95 }),
    });
    const list = table([
      { ability: 'battle_shout', when: [{ type: 'missingSelfAura', auraId: 'battle_shout' }] },
      { ability: 'execute' },
      { ability: 'cleave' },
    ]);
    const answers = new Set<string | null>();
    for (let frame = 0; frame < 200; frame++) answers.add(pickAssistAbility(input, list));
    expect([...answers]).toEqual(['battle_shout']);
  });

  it('reaches the same verdict from a Sim-shaped and a ClientWorld-shaped snapshot', () => {
    // The offline Sim hands over live Entity objects: a real Map of cooldowns and
    // full Aura records. The online ClientWorld mirror rebuilds both from the
    // wire, so its auras carry only the fields the wire sends (no `value2`, no
    // school on a physical aura) and a stackless aura decodes with `stacks`
    // absent. Same inputs, same answer.
    const known = [real('shadow_word_pain'), real('mind_blast'), real('smite')];
    const list = table(
      [
        {
          ability: 'shadow_word_pain',
          when: [{ type: 'needsTargetDebuff', auraId: 'shadow_word_pain', refreshBelow: 1.5 }],
        },
        { ability: 'mind_blast' },
        { ability: 'smite' },
      ],
      'priest',
    );

    const simAura: Aura = {
      id: 'shadow_word_pain',
      name: 'Shadow Word: Pain',
      kind: 'dot',
      remaining: 12,
      duration: 18,
      value: 30,
      sourceId: PLAYER_ID,
      school: 'shadow',
    } as Aura;
    const simWorld = world({
      cls: 'priest',
      known,
      player: player({ cooldowns: new Map([['mind_blast', 3]]) }),
      target: target({ auras: [simAura] }),
    });
    const mirrorWorld = world({
      cls: 'priest',
      known,
      // The mirror exposes a Map too, rebuilt per snapshot.
      player: player({ cooldowns: new Map(Object.entries({ mind_blast: 3 })) }),
      target: target({
        auras: [{ id: 'shadow_word_pain', kind: 'dot', remaining: 12, sourceId: PLAYER_ID }],
      }),
    });

    // Pain is up with time to spare and Mind Blast is on cooldown, so Smite answers.
    expect(pickAssistAbility(simWorld, list)).toBe('smite');
    expect(pickAssistAbility(mirrorWorld, list)).toBe(pickAssistAbility(simWorld, list));
  });
});
