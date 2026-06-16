import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity, SimEvent } from '../src/sim/types';
import { DUNGEONS, ITEMS, MOBS, instanceOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;

function makeWorld() {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
}

// Form a party with `leader` as leader and the rest as members.
function formParty(sim: Sim, leader: number, members: number[]) {
  for (const m of members) {
    sim.partyInvite(m, leader);
    sim.partyAccept(m);
  }
}

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.spawnPos = { ...e.pos };
}

describe('The Abyssal Maw — raid definition', () => {
  it('is a 10-player, level-20, party-gated underworld instance at a unique index', () => {
    const d = DUNGEONS.abyssal_maw;
    expect(d).toBeDefined();
    expect(d.interior).toBe('underworld');
    expect(d.suggestedPlayers).toBe(10);
    expect(d.minLevel).toBe(20);
    expect(d.requiresParty).toBe(true);
    // index 4 origin must sit clear of the arena band
    expect(d.index).toBe(4);
    expect(instanceOrigin(d.index, 0).x).toBe(3300);
  });

  it('every spawn references a real mob template', () => {
    for (const s of DUNGEONS.abyssal_maw.spawns) {
      expect(MOBS[s.mobId], `missing mob ${s.mobId}`).toBeDefined();
    }
  });
});

describe('The Abyssal Maw — entry gates', () => {
  it('blocks a solo level-20 player (requires a party)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Solo');
    sim.setPlayerLevel(20, a);
    sim.enterDungeon('abyssal_maw', a);
    expect(sim.entities.get(a)!.pos.x).toBeLessThan(600); // never teleported in
  });

  it('blocks an under-leveled party', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    formParty(sim, a, [b]);
    sim.enterDungeon('abyssal_maw', a);
    expect(sim.entities.get(a)!.pos.x).toBeLessThan(600);
  });

  it('admits a level-20 party into a shared instance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Anna');
    const b = sim.addPlayer('mage', 'Bert');
    sim.setPlayerLevel(20, a);
    sim.setPlayerLevel(20, b);
    formParty(sim, a, [b]);
    sim.enterDungeon('abyssal_maw', a);
    sim.enterDungeon('abyssal_maw', b);
    const pa = sim.entities.get(a)!;
    const pb = sim.entities.get(b)!;
    expect(pa.pos.x).toBeGreaterThan(600);
    expect(pb.pos.x).toBeGreaterThan(600);
    // a party shares one instance slot
    expect(sim.instanceSlotAt(pa.pos)).toBe(sim.instanceSlotAt(pb.pos));
  });
});

describe('The Abyssal Maw — boss loot', () => {
  it('each boss guarantees exactly one item from its armor/weapon group', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const meta = sim.meta(sim.playerId)!;
    const guaranteed: [string, string][] = [
      ['gorehoof_the_charwarden', 'gorehoof_armor'],
      ['malgazzar_the_flameborn', 'malgazzar_armor'],
      ['archlich_vekru', 'vekru_armor'],
      ['broodmother_xalthrea', 'xalthrea_armor'],
      ['xal_goreth_the_devourer', 'devourer_weapon'],
    ];
    for (const [bossId, groupId] of guaranteed) {
      const template = MOBS[bossId];
      const groupItems = template.loot.filter((l) => l.rollGroup === groupId).map((l) => l.itemId!);
      expect(groupItems.length, `${groupId} empty`).toBeGreaterThan(0);
      const seen = new Set<string>();
      const mob = createMob(900100, template, 20, { x: 0, y: 0, z: 0 });
      const lootOf = (m: Entity) => m.loot; // accessor defeats TS narrowing after `mob.loot = null`
      for (let i = 0; i < 300; i++) {
        mob.loot = null;
        (sim as any).rollLoot(mob, meta);
        const dropped = (lootOf(mob)?.items ?? []).filter((s) => groupItems.includes(s.itemId));
        expect(dropped.length, `${bossId}/${groupId} kill #${i}`).toBeGreaterThanOrEqual(1);
        if (dropped[0]) seen.add(dropped[0].itemId);
      }
      expect([...seen].sort()).toEqual([...groupItems].sort()); // every archetype reachable
    }
  });

  it('raid epics are best-in-slot — they exceed the Gravewyrm Sanctum set', () => {
    // weapons
    expect(ITEMS.cataclysms_edge.weapon!.max).toBeGreaterThan(ITEMS.wyrmfang_greatblade.weapon!.max);
    expect(ITEMS.staff_of_the_devourer.weapon!.max).toBeGreaterThan(ITEMS.staff_of_the_gravewyrm.weapon!.max);
    expect(ITEMS.fang_of_the_abyss.weapon!.max).toBeGreaterThan(ITEMS.fang_of_korzul.weapon!.max);
    // armor
    expect(ITEMS.emberforged_breastplate.stats!.armor!).toBeGreaterThan(ITEMS.deathlord_warplate.stats!.armor!);
    expect(ITEMS.cinderweave_robe.stats!.int!).toBeGreaterThan(ITEMS.necromancers_starshroud.stats!.int!);
    expect(ITEMS.ashstalker_jerkin.stats!.agi!).toBeGreaterThan(ITEMS.wyrmshadow_harness.stats!.agi!);
    // all raid gear is epic and archetype-locked
    for (const id of ['cataclysms_edge', 'staff_of_the_devourer', 'fang_of_the_abyss',
      'emberforged_breastplate', 'cinderweave_robe', 'ashstalker_jerkin']) {
      expect(ITEMS[id].quality).toBe('epic');
      expect(ITEMS[id].requiredClass!.length).toBeGreaterThan(0);
    }
  });
});

describe('The Abyssal Maw — deadly lava hazard', () => {
  it('burns a player standing in a lava lake but not on the safe path', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Anna');
    sim.setPlayerLevel(20, a);
    const p = sim.entities.get(a)!;
    const origin = instanceOrigin(4, 0);

    // Lake I centre (instance-local ~16,37) is molten ground
    place(sim, p, origin.x + 16, origin.z + 37);
    const before = p.hp;
    for (let i = 0; i < 30; i++) sim.tick(); // ~1.5s
    expect(p.hp).toBeLessThan(before);

    // the west lane beside it (instance-local -34,40) is safe stone
    p.hp = p.maxHp;
    place(sim, p, origin.x - 34, origin.z + 40);
    const safeBefore = p.hp;
    for (let i = 0; i < 30; i++) sim.tick();
    expect(p.hp).toBe(safeBefore);
  });
});

describe('The Abyssal Maw — telegraphed Void Zone', () => {
  // Engage a void-zone boss with an invulnerable (GM) tank so the fight is
  // stable long enough for the mechanic to cycle.
  function pullVekru(): { sim: Sim; events: SimEvent[] } {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(20, a);
    sim.setGm(a); // invulnerable: keeps the pull alive across the cast cycle
    const p = sim.entities.get(a)!;
    const boss = createMob(900200, MOBS.archlich_vekru, 20, { x: 3300, y: 0, z: -1250 });
    (sim as any).addEntity(boss);
    place(sim, boss, 3300, -1250);
    place(sim, p, 3302, -1250);
    p.targetId = boss.id;
    p.autoAttack = true;
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 30; i++) events.push(...sim.tick()); // 30s
    return { sim, events };
  }

  it('emits a telegraph + a localized boss-warning while in combat', () => {
    const { events } = pullVekru();
    const telegraphs = events.filter((e) => e.type === 'telegraph');
    const warnings = events.filter((e): e is Extract<SimEvent, { type: 'bossWarning' }> => e.type === 'bossWarning');
    expect(telegraphs.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.key === 'raidWarn.soulDetonation')).toBe(true);
  });

  it('is deterministic — same seed, same event-type stream', () => {
    const seq = () => pullVekru().events.map((e) => e.type).join(',');
    expect(seq()).toBe(seq());
  });
});
