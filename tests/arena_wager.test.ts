import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// The optional gold wager: during a bout's pre-fight wager window both fighters
// may pledge a stake from fixed tiers. The bet only locks if BOTH cover a tier
// (matched at the lower offer), escrows when the window closes, and pays the
// whole pot to the victor. These tests drive the Sim directly.

function makeWorld() {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Queue two players and tick once so matchmaking seats them in the wager phase.
function queueDuo(aGold = 100000, bGold = 100000): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = sim.addPlayer('warrior', 'Aleph');
  const b = sim.addPlayer('mage', 'Bet');
  teleport(sim, a, 0, -40);
  teleport(sim, b, 6, -40);
  sim.meta(a)!.copper = aGold;
  sim.meta(b)!.copper = bGold;
  sim.arenaQueueJoin(a);
  sim.arenaQueueJoin(b);
  sim.tick();
  return { sim, a, b };
}

// Run the 12s wager window out so the stake locks and the countdown opens.
function closeWagerWindow(sim: Sim) {
  for (let i = 0; i < 20 * 13; i++) {
    sim.tick();
    const m = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (m && m.state !== 'wager') return;
  }
}

function startBout(sim: Sim) {
  for (let i = 0; i < 20 * 24; i++) {
    sim.tick();
    const m = sim.arenaMatchFor([...sim.arenaMatches.keys()][0] ?? -1);
    if (m && m.state === 'active') return;
  }
}

describe('arena wager: matching + escrow', () => {
  it('a fresh bout opens in the wager window with no stake', () => {
    const { sim, a } = queueDuo();
    const m = sim.arenaMatchFor(a)!;
    expect(m.state).toBe('wager');
    expect(m.stake).toBe(0);
    expect(m.escrowed).toBe(false);
    expect(sim.arenaInfoFor(a)!.match!.wagerEndsIn).toBeGreaterThan(0);
  });

  it('matches the bet at the lower of the two pledges and escrows on close', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    sim.arenaPlaceWager(10000, a); // Aleph pledges 1g
    sim.arenaPlaceWager(5000, b); //  Bet pledges 50s
    // live preview before lock: the matched pot is 2× the lower offer
    expect(sim.arenaInfoFor(a)!.match!.pot).toBe(10000);
    expect(sim.arenaInfoFor(a)!.match!.stakeLocked).toBe(false);

    closeWagerWindow(sim);
    const m = sim.arenaMatchFor(a)!;
    expect(m.stake).toBe(5000); // the lower pledge
    expect(m.pot).toBe(10000);
    expect(m.escrowed).toBe(true);
    // both are down their matched stake while it sits in escrow
    expect(sim.meta(a)!.copper).toBe(95000);
    expect(sim.meta(b)!.copper).toBe(95000);
  });

  it('a one-sided pledge never locks — no opponent stake, no bet', () => {
    const { sim, a, b } = queueDuo();
    sim.arenaPlaceWager(10000, a); // only Aleph bets
    closeWagerWindow(sim);
    const m = sim.arenaMatchFor(a)!;
    expect(m.stake).toBe(0);
    expect(m.escrowed).toBe(false);
    expect(sim.meta(a)!.copper).toBe(100000); // nothing taken
    expect(sim.meta(b)!.copper).toBe(100000);
  });

  it('snaps a pledge down to the highest tier the fighter can afford', () => {
    const { sim, a } = queueDuo(7000, 100000); // Aleph holds 70s
    sim.arenaPlaceWager(10000, a); // tries to bet 1g
    // 1g unaffordable; 50s (5000) is the highest tier within 70s
    expect(sim.arenaMatchFor(a)!.offerA).toBe(5000);
  });

  it('only accepts pledges during the wager window', () => {
    const { sim, a, b } = queueDuo();
    sim.arenaPlaceWager(10000, a);
    expect(sim.arenaMatchFor(a)!.offerA).toBe(10000); // accepted in-window
    closeWagerWindow(sim);
    // window closed: a late pledge changes nothing and escrows nothing
    sim.arenaPlaceWager(50000, b);
    expect(sim.arenaMatchFor(a)!.offerB).toBe(0);
    expect(sim.arenaMatchFor(a)!.escrowed).toBe(false);
    expect(sim.meta(b)!.copper).toBe(100000);
  });
});

describe('arena wager: payout', () => {
  it('the winner takes the whole pot; the loser is down their stake', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    sim.arenaPlaceWager(10000, a);
    sim.arenaPlaceWager(10000, b);
    closeWagerWindow(sim);
    startBout(sim);
    expect(sim.meta(a)!.copper).toBe(90000); // both escrowed 1g
    expect(sim.meta(b)!.copper).toBe(90000);

    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    (sim as any).dealDamage(ea, eb, 99999, false, 'physical', null, 'hit');
    const ev = sim.tick();

    // Aleph wins: own stake back + Bet's stake = +1g net vs the start
    expect(sim.meta(a)!.copper).toBe(110000);
    expect(sim.meta(b)!.copper).toBe(90000);
    expect(sim.meta(a)!.arenaGoldWon).toBe(10000);
    const end = ev.find((e) => e.type === 'arenaEnd' && (e as any).pid === a) as any;
    expect(end.goldDelta).toBe(10000);
  });

  it('a draw refunds both stakes', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    sim.arenaPlaceWager(5000, a);
    sim.arenaPlaceWager(5000, b);
    closeWagerWindow(sim);
    startBout(sim);
    expect(sim.meta(a)!.copper).toBe(95000);

    // force a timeout draw directly (both at equal health)
    const m = sim.arenaMatchFor(a)!;
    (sim as any).endArenaMatch(m, null, 'timeout');
    expect(sim.meta(a)!.copper).toBe(100000); // refunded
    expect(sim.meta(b)!.copper).toBe(100000);
    expect(sim.meta(a)!.arenaGoldWon).toBe(0);
  });

  it('an unwagered bout moves no gold', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    closeWagerWindow(sim);
    startBout(sim);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    (sim as any).dealDamage(ea, eb, 99999, false, 'physical', null, 'hit');
    sim.tick();
    expect(sim.meta(a)!.copper).toBe(100000);
    expect(sim.meta(b)!.copper).toBe(100000);
  });

  it('forfeiting a locked wager hands the pot to the opponent', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    sim.arenaPlaceWager(10000, a);
    sim.arenaPlaceWager(10000, b);
    closeWagerWindow(sim);
    startBout(sim);
    sim.removePlayer(b); // Bet rage-quits a wagered bout
    expect(sim.meta(a)!.copper).toBe(110000); // survivor collects the pot
    expect(sim.meta(a)!.arenaGoldWon).toBe(10000);
  });

  it('forfeiting before the wager locks moves no gold', () => {
    const { sim, a, b } = queueDuo(100000, 100000);
    sim.arenaPlaceWager(10000, a);
    sim.arenaPlaceWager(10000, b);
    // still inside the wager window — nothing escrowed yet
    sim.removePlayer(b);
    expect(sim.meta(a)!.copper).toBe(100000);
  });

  it('arenaGoldWon round-trips through CharacterState', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('paladin', 'Tyr');
    sim.meta(a)!.arenaGoldWon = 42000;
    const state = sim.serializeCharacter(a)!;
    expect(state.arenaGoldWon).toBe(42000);

    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('paladin', 'Tyr', { state });
    expect(sim2.meta(a2)!.arenaGoldWon).toBe(42000);
  });
});
