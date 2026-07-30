// The Assist evaluator against a REAL Sim, not a modelled snapshot.
//
// The unit suites drive `pickAssistAbility` from hand-built inputs, and the
// class suite drives it from real known lists. Neither can catch the one failure
// that would make the button useless in play: an upkeep rung whose `missing*`
// gate never clears, because the aura the sim actually applies does not land
// where or under the id the table expects. That reads as "Assist re-casts Battle
// Shout forever" and no amount of modelling would show it, so this suite closes
// the loop: pick, cast through the real sim, tick, pick again.

import { describe, expect, it } from 'vitest';
import { ROTATION_PRIORITIES } from '../src/sim/content/rotations';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, type PlayerClass } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import type {
  AssistTargetInput,
  AssistWorldInput,
} from '../src/ui/hud/action_bar/assist_rotation_core';
import { pickAssistAbility } from '../src/ui/hud/action_bar/assist_rotation_core';
import { playerStealthed } from '../src/ui/hud/action_bar/player_stealthed';

const CLASS_IDS = Object.keys(ROTATION_PRIORITIES) as PlayerClass[];
// Ticks between presses: past the 1.5s GCD (DT = 1/20) so each press lands.
const TICKS_BETWEEN_PRESSES = 40;

/** One world MOB, dragged into melee reach and given enough health to survive the
 *  run, with every other mob parked far away so nothing else interferes.
 *
 *  A mob, not a second player: two players are not hostile to each other without
 *  a duel or PvP flag, so a player-shaped dummy silently refuses every hostile
 *  cast, and the suite would then be asserting about casts that never happened. */
function stagedSim(cls: PlayerClass): { sim: Sim; dummyId: number } {
  const sim = new Sim({ seed: 7, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  let dummy: ReturnType<Sim['entities']['get']> | undefined;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (dummy === undefined) {
      dummy = e;
      continue;
    }
    e.pos.x += 10000;
    e.pos.z += 10000;
    e.prevPos = { ...e.pos };
    e.spawnPos = { ...e.pos };
    e.leashAnchor = { ...e.pos };
    e.aggroTargetId = null;
  }
  if (!dummy) throw new Error('no world mob to use as a target dummy');
  dummy.pos.x = p.pos.x + 2;
  dummy.pos.z = p.pos.z;
  dummy.pos.y = terrainHeight(dummy.pos.x, dummy.pos.z, sim.cfg.seed);
  dummy.prevPos = { ...dummy.pos };
  dummy.spawnPos = { ...dummy.pos };
  dummy.leashAnchor = { ...dummy.pos };
  dummy.level = 20;
  dummy.maxHp = 500000;
  dummy.hp = dummy.maxHp;
  p.targetId = dummy.id;
  return { sim, dummyId: dummy.id };
}

function snapshot(sim: Sim, dummyId: number): AssistWorldInput {
  const p = sim.player;
  const dummy = sim.entities.get(dummyId);
  const target: AssistTargetInput | null = dummy
    ? {
        dead: dummy.dead,
        hostile: dummy.hostile,
        hp: dummy.hp,
        maxHp: dummy.maxHp,
        pos: dummy.pos,
        auras: dummy.auras,
      }
    : null;
  return {
    cls: sim.cfg.playerClass,
    spec: sim.talentSpec,
    known: sim.known,
    // The exact two derivations hud.ts makes for this call.
    player: { ...p, stealthed: playerStealthed(p.auras) },
    target,
  };
}

/** Press the Assist button `presses` times against a live sim, returning the sim
 *  and what the button fired each time. Resources and health are topped up
 *  between presses so the sequence exercises the PRIORITY ORDER rather than
 *  running dry, and the dummy is kept alive and in reach. */
function pressAssist(
  cls: PlayerClass,
  presses: number,
): { sim: Sim; dummyId: number; fired: string[] } {
  const { sim, dummyId } = stagedSim(cls);
  const fired: string[] = [];
  for (let i = 0; i < presses; i++) {
    const p = sim.player;
    p.resource = p.maxResource;
    p.hp = p.maxHp;
    const dummy = sim.entities.get(dummyId);
    if (dummy) {
      dummy.hp = dummy.maxHp;
      dummy.dead = false;
      dummy.pos.x = p.pos.x + 2;
      dummy.pos.z = p.pos.z;
      p.targetId = dummyId;
    }
    const pick = pickAssistAbility(snapshot(sim, dummyId));
    if (pick === null) break;
    fired.push(pick);
    sim.castAbility(pick);
    for (let t = 0; t < TICKS_BETWEEN_PRESSES; t++) sim.tick();
  }
  return { sim, dummyId, fired };
}

describe('Assist against a live Sim', () => {
  it.each(CLASS_IDS)('%s: never gets stuck re-casting its own upkeep buff', (cls) => {
    const { fired } = pressAssist(cls, 10);
    expect(fired.length, `${cls} produced no presses`).toBeGreaterThan(0);
    // The upkeep rungs are the ones gated on their own aura being missing. Once
    // the real sim has applied that aura, the rung must stop winning: the stuck
    // signature is the SAME upkeep press twice in a row. A later re-fire is not a
    // defect and must not be asserted away: a charge-limited buff (the shaman's
    // Lightning Shield spends a charge per melee hit and vanishes at zero) is
    // legitimately re-cast mid-fight, which is the gate working, not failing.
    const upkeep = new Set(
      ROTATION_PRIORITIES[cls]
        .filter((entry) =>
          (entry.when ?? []).some(
            (c) =>
              (c.type === 'missingSelfAura' && c.auraId === entry.ability) ||
              c.type === 'missingSelfAuraKind',
          ),
        )
        .map((entry) => entry.ability),
    );
    for (let i = 1; i < fired.length; i++) {
      if (!upkeep.has(fired[i])) continue;
      expect(
        fired[i - 1],
        `${cls}: ${fired[i]} fired twice in a row, so its gate never cleared (sequence: ${fired.join(' > ')})`,
      ).not.toBe(fired[i]);
    }
  });

  it.each(CLASS_IDS)('%s: reaches a damage press within the first few taps', (cls) => {
    const { fired } = pressAssist(cls, 8);
    const damaging = fired.filter((id) =>
      ABILITIES[id].effects.some((e) =>
        [
          'weaponDamage',
          'weaponStrike',
          'directDamage',
          'finisherDamage',
          'dot',
          'aoeDamage',
          'groundAoE',
          'drainTick',
          'judgement',
          'empoweredCone',
        ].includes(e.type),
      ),
    );
    expect(
      damaging.length,
      `${cls} never reached a damage press (sequence: ${fired.join(' > ')})`,
    ).toBeGreaterThan(0);
  });

  it('re-applies a warlock DoT only after it actually expires', () => {
    // Let the Assist button open the fight for itself: Demon Skin, then the three
    // DoTs in priority order. Driving the real button rather than hand-casting is
    // the point, because the setup and the assertion then share one code path.
    const { sim, dummyId, fired } = pressAssist('warlock', 5);
    expect(fired, `assist sequence: ${fired.join(' > ')}`).toContain('corruption');
    const p = sim.player;
    const dummy = sim.entities.get(dummyId);
    const worn = dummy?.auras.find((a) => a.id === 'corruption');
    expect(worn, 'corruption did not land on the target').toBeDefined();
    expect(worn?.sourceId, 'the dot is not attributed to the caster').toBe(p.id);
    p.resource = p.maxResource;
    // Every DoT rung above it is satisfied and Corruption has plenty of duration
    // left, so the assist must have moved on to a nuke.
    expect(pickAssistAbility(snapshot(sim, dummyId))).not.toBe('corruption');
    // Wind it into the refresh window and it becomes the answer again.
    if (worn) worn.remaining = 1;
    expect(pickAssistAbility(snapshot(sim, dummyId))).toBe('corruption');
  });

  it('holds Execute until the real target is inside its kill window', () => {
    // Two presses is enough for the assist to clear its own Battle Shout rung, so
    // Execute is what the next press is actually deciding about.
    const { sim, dummyId } = pressAssist('warrior', 2);
    const p = sim.player;
    const dummy = sim.entities.get(dummyId);
    if (!dummy) throw new Error('dummy missing');
    p.resource = p.maxResource;
    dummy.hp = dummy.maxHp;
    dummy.pos.x = p.pos.x + 2;
    dummy.pos.z = p.pos.z;
    expect(dist2d(p.pos, dummy.pos)).toBeLessThan(5);
    expect(pickAssistAbility(snapshot(sim, dummyId))).not.toBe('execute');
    dummy.hp = Math.floor(dummy.maxHp * 0.1);
    expect(pickAssistAbility(snapshot(sim, dummyId))).toBe('execute');
  });

  it('answers nothing once the player is dead', () => {
    const { sim, dummyId } = stagedSim('mage');
    sim.player.dead = true;
    expect(pickAssistAbility(snapshot(sim, dummyId))).toBeNull();
  });
});
