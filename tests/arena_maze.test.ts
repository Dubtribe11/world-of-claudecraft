import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { arenaMapForSlot, arenaOrigin } from '../src/sim/data';
import { ARENA_SPAWN_A, ARENA_SPAWN_B, LABYRINTH_LAYOUT } from '../src/sim/dungeon_layout';
import { arenaLineOfSightClear, isBlocked } from '../src/sim/colliders';

// The Labyrinth maze map + real arena line-of-sight. The layout drives both the
// render geometry and the collider set, so these checks (collision, sightline,
// reachability) validate the gameplay contract the renderer also honours.

const SEED = 7;

// A labyrinth instance lives in an odd slot; the coliseum in an even one.
const labyrinthSlot = 1;
const coliseumSlot = 0;

function makeWorld() {
  return new Sim({ seed: SEED, playerClass: 'mage', noPlayer: true });
}

// Walkability flood over a slot's interior grid (1-yd cells), 4-connected.
function reachable(slot: number, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const o = arenaOrigin(slot);
  const key = (x: number, z: number) => `${x},${z}`;
  const walkable = (lx: number, lz: number) => !isBlocked(SEED, o.x + lx, o.z + lz, 0.4);
  const start = { x: Math.round(from.x), z: Math.round(from.z) };
  const goal = { x: Math.round(to.x), z: Math.round(to.z) };
  const seen = new Set<string>([key(start.x, start.z)]);
  const queue = [start];
  while (queue.length) {
    const c = queue.shift()!;
    if (c.x === goal.x && c.z === goal.z) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx, nz = c.z + dz;
      if (nx < -22 || nx > 22 || nz < -19 || nz > 23) continue;
      if (seen.has(key(nx, nz)) || !walkable(nx, nz)) continue;
      seen.add(key(nx, nz));
      queue.push({ x: nx, z: nz });
    }
  }
  return false;
}

describe('labyrinth layout', () => {
  it('is the map assigned to odd arena slots', () => {
    expect(arenaMapForSlot(labyrinthSlot)).toBe('labyrinth');
    expect(arenaMapForSlot(coliseumSlot)).toBe('coliseum');
  });

  it('leaves both spawn points clear of maze geometry', () => {
    const o = arenaOrigin(labyrinthSlot);
    expect(isBlocked(SEED, o.x + ARENA_SPAWN_A.x, o.z + ARENA_SPAWN_A.z, 0.4)).toBe(false);
    expect(isBlocked(SEED, o.x + ARENA_SPAWN_B.x, o.z + ARENA_SPAWN_B.z, 0.4)).toBe(false);
  });

  it('keeps both spawns mutually reachable through the maze', () => {
    expect(reachable(labyrinthSlot, ARENA_SPAWN_A, ARENA_SPAWN_B)).toBe(true);
  });

  it('denies the straight spawn-to-spawn sightline with the central spine', () => {
    const o = arenaOrigin(labyrinthSlot);
    const clear = arenaLineOfSightClear(
      o.x + ARENA_SPAWN_A.x, o.z + ARENA_SPAWN_A.z,
      o.x + ARENA_SPAWN_B.x, o.z + ARENA_SPAWN_B.z,
    );
    expect(clear).toBe(false);
  });

  it('leaves that same sightline open in the unobstructed coliseum', () => {
    const o = arenaOrigin(coliseumSlot);
    const clear = arenaLineOfSightClear(
      o.x + ARENA_SPAWN_A.x, o.z + ARENA_SPAWN_A.z,
      o.x + ARENA_SPAWN_B.x, o.z + ARENA_SPAWN_B.z,
    );
    expect(clear).toBe(true);
  });

  it('places every obstacle point-symmetric about the pit centre (0, 2)', () => {
    const mirror = (x: number, z: number) => ({ x: -x, z: 4 - z });
    const near = (a: { x: number; z: number }, b: { x: number; z: number }) =>
      Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
    for (const p of LABYRINTH_LAYOUT.pillars) {
      const m = mirror(p.x, p.z);
      expect(LABYRINTH_LAYOUT.pillars.some((q) => near(q, m))).toBe(true);
    }
    for (const s of LABYRINTH_LAYOUT.stubs) {
      const m = mirror(s.x, s.z);
      expect(LABYRINTH_LAYOUT.stubs.some((t) => near(t, m) && t.hw === s.hw && t.hd === s.hd)).toBe(true);
    }
  });
});

describe('arena line of sight: geometry', () => {
  it('a short hop in a clear lane is in sight', () => {
    const o = arenaOrigin(labyrinthSlot);
    // both points in the open right-hand lane, no wall between them
    expect(arenaLineOfSightClear(o.x + 18, o.z - 14, o.x + 18, o.z - 6)).toBe(true);
  });

  it('a sightline crossing a maze wall is broken', () => {
    const o = arenaOrigin(labyrinthSlot);
    // straight across the central spine (z=2)
    expect(arenaLineOfSightClear(o.x + 0, o.z - 6, o.x + 0, o.z + 6)).toBe(false);
  });
});

// ---- integration: LoS actually gates casts inside the pit ------------------

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Seat a labyrinth bout (the first match always draws the labyrinth) and run it
// live, returning the mage caster + warrior target and the instance origin.
function labyrinthBout() {
  const sim = makeWorld();
  const mage = sim.addPlayer('mage', 'Caster');
  const warrior = sim.addPlayer('warrior', 'Target');
  teleport(sim, mage, 0, -40);
  teleport(sim, warrior, 6, -40);
  sim.setPlayerLevel(10, mage);
  sim.setPlayerLevel(10, warrior);
  sim.arenaQueueJoin(mage);
  sim.arenaQueueJoin(warrior);
  sim.tick();
  for (let i = 0; i < 20 * 24; i++) {
    sim.tick();
    if (sim.arenaMatchFor(mage)?.state === 'active') break;
  }
  return { sim, mage, warrior, o: arenaOrigin(sim.arenaMatchFor(mage)!.slot), map: sim.arenaMatchFor(mage)!.map };
}

function setLocal(sim: Sim, o: { x: number; z: number }, pid: number, lx: number, lz: number) {
  teleport(sim, pid, o.x + lx, o.z + lz);
}

function faceAt(sim: Sim, pid: number, targetId: number) {
  const e = sim.entities.get(pid)!;
  const t = sim.entities.get(targetId)!;
  e.facing = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
}

describe('arena line of sight: casting', () => {
  it('refuses a ranged cast when a maze wall blocks the target', () => {
    const { sim, mage, warrior, o, map } = labyrinthBout();
    expect(map).toBe('labyrinth'); // the first bout draws the maze
    // opposite sides of the central spine
    setLocal(sim, o, mage, 0, -6);
    setLocal(sim, o, warrior, 0, 6);
    const m = sim.entities.get(mage)!;
    m.targetId = warrior;
    m.resource = m.maxResource; m.gcdRemaining = 0; m.cooldowns.clear();
    faceAt(sim, mage, warrior);

    sim.castAbility('fireball', mage);
    expect(m.castingAbility).toBe(null); // refused: not in line of sight
    const ev = sim.tick();
    expect(ev.some((e) => e.type === 'error' && /line of sight/i.test((e as any).text))).toBe(true);
  });

  it('lands the same cast once the caster has a clear lane', () => {
    const { sim, mage, warrior, o } = labyrinthBout();
    // both in the open x=16 corridor (clear of the inner and outer pillars)
    setLocal(sim, o, mage, 16, -12);
    setLocal(sim, o, warrior, 16, -2);
    const m = sim.entities.get(mage)!;
    m.targetId = warrior;
    m.resource = m.maxResource; m.gcdRemaining = 0; m.cooldowns.clear();
    faceAt(sim, mage, warrior);

    sim.castAbility('fireball', mage);
    expect(m.castingAbility).toBe('fireball'); // clear sightline: the cast begins
  });

  it('fizzles a cast when the target jukes behind a pillar mid-cast', () => {
    const { sim, mage, warrior, o } = labyrinthBout();
    // start clear: both south of the spine
    setLocal(sim, o, mage, 0, -10);
    setLocal(sim, o, warrior, 0, -4);
    const m = sim.entities.get(mage)!;
    const w = sim.entities.get(warrior)!;
    w.hp = w.maxHp;
    m.targetId = warrior;
    m.resource = m.maxResource; m.gcdRemaining = 0; m.cooldowns.clear();
    faceAt(sim, mage, warrior);

    sim.castAbility('fireball', mage);
    expect(m.castingAbility).toBe('fireball');

    // the warrior ducks across the spine while the bolt is in flight
    setLocal(sim, o, warrior, 0, 10);
    for (let i = 0; i < 20 * 4 && m.castingAbility; i++) sim.tick();

    expect(m.castingAbility).toBe(null); // cast resolved (or broke)
    expect(w.hp).toBe(w.maxHp); // …but the juked bolt dealt no damage
  });

  it('lets melee abilities ignore line of sight', () => {
    const { sim, mage, warrior } = labyrinthBout();
    const m = sim.entities.get(mage)!;
    // a melee-range ability is never LoS-gated, even with a wall between
    expect((sim as any).arenaLosClear(m, sim.entities.get(warrior)!, { range: 0 })).toBe(true);
  });
});

describe('arena map rotation', () => {
  it('seats back-to-back bouts on different maps', () => {
    const sim = makeWorld();
    const pids = ['A', 'B', 'C', 'D'].map((n, i) => {
      const pid = sim.addPlayer('warrior', n);
      teleport(sim, pid, i * 4, -40);
      return pid;
    });
    for (const pid of pids) sim.arenaQueueJoin(pid);
    sim.tick(); // matchmakeArena seats both pairs

    const maps = new Set<string>();
    for (const pid of pids) {
      const m = sim.arenaMatchFor(pid);
      if (m) maps.add(m.map);
    }
    expect(maps).toEqual(new Set(['coliseum', 'labyrinth']));
  });
});
