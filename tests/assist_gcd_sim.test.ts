// The assist global-cooldown tax against a REAL Sim, and across the seam that
// carries it to the authoritative server.
//
// assist_gcd.test.ts pins the arithmetic. This suite pins the two things the
// arithmetic cannot say on its own: that the taxed value is what an assisted cast
// ACTUALLY arms on a live player (so the tax is not sitting in an unreached
// branch), and that the online path routes an assisted press to the taxed cast
// instead of the plain one (so a mobile player online pays the same tax an
// offline player does, which is the whole three-hosts-one-sim contract).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { GameServer } from '../server/game';
import { ASSIST_GCD_PENALTY_MULT } from '../src/sim/combat/assist_gcd';
import { Sim } from '../src/sim/sim';
import { GCD, type PlayerClass } from '../src/sim/types';

const FIREBALL = 'fireball';

/** A level-20 caster with a live hostile mob in melee reach and full resource, the
 *  minimum state an offensive cast needs to actually resolve. */
function stagedSim(cls: PlayerClass = 'mage'): { sim: Sim; dummyId: number } {
  const sim = new Sim({ seed: 11, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  let dummyId: number | null = null;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    dummyId = e.id;
    e.pos.x = p.pos.x + 2;
    e.pos.z = p.pos.z;
    e.pos.y = p.pos.y;
    e.prevPos = { ...e.pos };
    e.level = 20;
    e.maxHp = 500_000;
    e.hp = e.maxHp;
    break;
  }
  if (dummyId === null) throw new Error('no world mob to use as a target dummy');
  p.targetId = dummyId;
  p.resource = p.maxResource;
  p.facing = 0;
  return { sim, dummyId };
}

/** The GCD one cast of `abilityId` arms on a fresh player. */
function gcdAfterCast(cast: (sim: Sim, abilityId: string) => void, abilityId: string): number {
  const { sim } = stagedSim();
  sim.player.gcdRemaining = 0;
  cast(sim, abilityId);
  return sim.player.gcdRemaining;
}

describe('an assisted cast arms a longer global cooldown on a live Sim', () => {
  it('taxes the assisted press and leaves the manual press alone', () => {
    const manual = gcdAfterCast((sim, id) => sim.castAbility(id), FIREBALL);
    const assisted = gcdAfterCast((sim, id) => sim.castAssistedAbility(id), FIREBALL);
    // Vacuity floor first: a cast that silently failed would leave both at 0 and
    // make the ratio assertion below pass for the wrong reason.
    expect(manual).toBeGreaterThan(0);
    expect(manual).toBeCloseTo(GCD, 5);
    expect(assisted).toBeCloseTo(manual * ASSIST_GCD_PENALTY_MULT, 5);
    expect(assisted).toBeGreaterThan(manual);
  });

  it('still casts the ability: the tax is a cooldown, not a rejection', () => {
    const { sim, dummyId } = stagedSim();
    const before = sim.entities.get(dummyId)?.hp ?? 0;
    const resourceBefore = sim.player.resource;
    sim.castAssistedAbility(FIREBALL);
    // Fireball has a cast time, so run the bar down and let the missile land.
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(sim.player.resource).toBeLessThan(resourceBefore);
    expect(sim.entities.get(dummyId)?.hp ?? 0).toBeLessThan(before);
  });

  it('leaves an off-GCD ability off the GCD, taxed or not', () => {
    // The tax rides the GCD, so an ability that arms no GCD must arm none either
    // way; otherwise the assist would invent a global cooldown out of nothing.
    const { sim } = stagedSim('warrior');
    const offGcd = sim.known.find((k) => k.def.offGcd && !k.def.passive);
    expect(offGcd, 'a warrior kit with no off-GCD ability makes this case vacuous').toBeTruthy();
    if (!offGcd) return;
    sim.player.gcdRemaining = 0;
    sim.castAssistedAbility(offGcd.def.id);
    expect(sim.player.gcdRemaining).toBe(0);
  });

  it('is deterministic: the same assisted cast arms the same GCD twice', () => {
    const once = gcdAfterCast((sim, id) => sim.castAssistedAbility(id), FIREBALL);
    const twice = gcdAfterCast((sim, id) => sim.castAssistedAbility(id), FIREBALL);
    expect(once).toBe(twice);
  });
});

describe('the online path pays the same tax (three hosts, one sim)', () => {
  function joinedServer() {
    const server = new GameServer();
    const sent: unknown[] = [];
    const ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
    const session = server.join(ws as never, 1, 1, 'Assistgcd', 'mage', null, false, {});
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const sim = (server as unknown as { sim: Sim }).sim;
    return { server, session, sim };
  }

  const cmd = (
    server: GameServer,
    session: Parameters<GameServer['handleMessage']>[0],
    payload: Record<string, unknown>,
  ) => server.handleMessage(session, JSON.stringify({ t: 'cmd', ...payload }));

  it("routes {cmd:'cast', assist:1} to the taxed cast and a plain cast to the untaxed one", () => {
    const { server, session, sim } = joinedServer();
    const assisted = vi.spyOn(sim, 'castAssistedAbility');
    const plain = vi.spyOn(sim, 'castAbility');

    cmd(server, session, { cmd: 'cast', ability: FIREBALL });
    expect(plain).toHaveBeenCalledWith(FIREBALL, session.pid);
    expect(assisted).not.toHaveBeenCalled();

    plain.mockClear();
    cmd(server, session, { cmd: 'cast', ability: FIREBALL, assist: 1 });
    expect(assisted).toHaveBeenCalledWith(FIREBALL, session.pid);
    expect(plain).not.toHaveBeenCalled();
  });

  it('degrades a malformed assist marker to an ordinary cast, never a silent tax', () => {
    // The server reads the flag as an exact `=== 1`, so a stray `true` / `"1"` / 0
    // from an old or broken client casts untaxed instead of penalising a player who
    // never opted in. Each junk value is checked on its own, not as one "any of".
    for (const junk of [true, '1', 0, null, {}]) {
      const { server, session, sim } = joinedServer();
      const assisted = vi.spyOn(sim, 'castAssistedAbility');
      const plain = vi.spyOn(sim, 'castAbility');
      cmd(server, session, { cmd: 'cast', ability: FIREBALL, assist: junk });
      expect(assisted, `assist:${JSON.stringify(junk)} must not tax`).not.toHaveBeenCalled();
      expect(plain).toHaveBeenCalledWith(FIREBALL, session.pid);
    }
  });

  it('keeps the mouseover-target override on the untaxed friendly path', () => {
    // A friendly mouseover cast carries a `target` id and is never an assist press
    // (the assist only ever fires castAssistedAbility), so `target` must keep
    // winning: an assist marker riding along must not divert it.
    const { server, session, sim } = joinedServer();
    const on = vi.spyOn(sim, 'castAbilityOn');
    const assisted = vi.spyOn(sim, 'castAssistedAbility');
    cmd(server, session, { cmd: 'cast', ability: FIREBALL, target: session.pid, assist: 1 });
    expect(on).toHaveBeenCalledWith(FIREBALL, session.pid, session.pid);
    expect(assisted).not.toHaveBeenCalled();
  });
});
