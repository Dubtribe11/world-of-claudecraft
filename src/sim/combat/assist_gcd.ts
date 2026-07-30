// The global-cooldown tax an ASSISTED cast pays: the price of letting the game
// pick the next ability for you instead of pressing it yourself.
//
// WHY IT EXISTS. The mobile Assist button (settings.mobileAssistRotation) walks
// the authored class priority list and fires whatever comes next, so one thumb
// plays a rotation no thumb could otherwise reach: perfect ordering, perfect
// upkeep, no page cycling, no misclicks. Left untaxed that is free throughput
// over a player working their own bar. The tax makes the trade explicit: the
// assist keeps the CONVENIENCE and gives back some of the SPEED, so a player who
// wants the fastest rotation still has to drive it themselves.
//
// WHY THE GCD AND NOT DAMAGE. A longer global cooldown scales with how much the
// assist is actually used (every assisted press pays, a manual press in between
// never does), needs no per-ability balance table, and shows up in the UI for
// free: the action bar already paints `player.gcdRemaining`, so the longer sweep
// IS the feedback. It also cannot be turned into a damage exploit, because it
// never touches an ability's own numbers, only how soon the NEXT press lands.
//
// CONTRACT
//   - Pure, deterministic, host-agnostic: no clock, no rng, no DOM. It runs
//     identically in the offline Sim, on the authoritative server, and headless.
//   - The tax is applied to the ALREADY-RESOLVED base GCD (after class GCD and
//     spell haste), so haste keeps helping an assisted rotation proportionally
//     rather than being cancelled out.
//   - Multiplicative and >= 1, so an assisted GCD is never SHORTER than a manual
//     one and never falls under the sim's MIN_GCD floor that the base already
//     cleared.
//   - The flag is a CLIENT-DECLARED intent the server trusts, exactly like the
//     rest of the cast command. That is deliberate: a client that lies is a
//     client running its own rotation bot, which no server-side check
//     distinguishes from a fast player anyway, so the honest signal is what the
//     tax is priced against. Nothing about the flag can make a cast SUCCEED that
//     a manual press would not (server authority is unchanged); it can only make
//     the caster slower.

/**
 * How much longer the global cooldown runs after an assisted cast. 1.2 = 20%
 * longer, i.e. about a sixth fewer casts per fight than driving the same
 * rotation by hand, which is roughly what perfect priority ordering is worth.
 * One named constant so re-tuning the tax is a one-line balance change.
 */
export const ASSIST_GCD_PENALTY_MULT = 1.2;

/**
 * The global cooldown a cast should arm: `baseGcd` for a manual press, the taxed
 * value for an assisted one. `mult` is injectable so a test can pin the shape of
 * the math without depending on the shipped tuning value.
 */
export function assistedGcd(
  baseGcd: number,
  assisted: boolean,
  mult: number = ASSIST_GCD_PENALTY_MULT,
): number {
  if (!assisted) return baseGcd;
  // A mult below 1 would hand the assist a SHORTER global cooldown than a manual
  // press, inverting the whole point; clamp rather than trust the caller.
  return baseGcd * Math.max(1, mult);
}
