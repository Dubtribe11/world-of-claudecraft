// Arena season settlement: the server-side authority that closes a season and
// awards its Warmaster title.
//
// Split in two on purpose. `pickArenaSeasonChampions` is a PURE function from
// candidate rows to award rows: every ranking and tie-break rule lives there and
// is unit-tested without a database. `createArenaSeasonSettler` is the thin
// self-clocked driver around it: poll the clock, ask which closed seasons are
// still unsettled, and commit each one through the transaction that writes the
// exactly-once marker beside the awards.
//
// Why the server and not the sim: a champion is a realm-wide ranking over every
// character, online or not, at a real-world instant. The sim sees only the
// players in its own world and has no wall clock (root CLAUDE.md determinism
// invariant), so the decision is made here and handed back through the join
// award lane, where the sim remains the only thing that writes a deed. Same
// division as the daily raid reset, which computes its boundary on the server
// and injects the instant.
//
// Two properties worth stating plainly because they are design choices, not
// accidents:
// - Standings are read at SETTLEMENT time, not sampled at the closing instant.
//   A realm that was down when a season closed settles on the next boot against
//   ratings that have moved slightly. Sampling the exact instant would need a
//   per-tick snapshot of every character's rating, which is a far larger and
//   more fragile machine than the outcome justifies.
// - Ratings are NOT reset between seasons; the all-time ladder is untouched. A
//   season is a window with a title at the end of it. What makes a champion the
//   champion OF that season is the entrants gate (they must have fought a ranked
//   bout inside the window), not a fresh ladder.

import {
  ARENA_SEASON_BRACKETS,
  type ArenaSeasonBracket,
  arenaSeasonIndexAt,
  lastClosedArenaSeasonAt,
} from '../src/sim/arena_season';
import { arenaSeasonDef } from '../src/sim/content/arena_seasons';
import type {
  ArenaSeasonPairCandidate,
  ArenaSeasonSoloCandidate,
  ArenaSeasonTitleRow,
} from './arena_season_db';

/** How often the driver looks at the clock. A season boundary is a half-year
 *  event, so this only has to be small next to "a player might log in and
 *  wonder"; it is a clock read plus, at most once per season, one small read
 *  set. */
export const ARENA_SEASON_POLL_MS = 5 * 60_000;

/** One awarded title, ready to persist and to log. */
export interface ArenaSeasonAward extends ArenaSeasonTitleRow {
  bracket: ArenaSeasonBracket;
  name: string;
}

/** The candidate sets one season's settlement scores. */
export interface ArenaSeasonCandidates {
  season: number;
  solo: readonly ArenaSeasonSoloCandidate[];
  pairs: readonly ArenaSeasonPairCandidate[];
}

// Byte-order name compare, deliberately locale-independent: the tie-break must
// produce the same winner on every host, and Intl collation does not.
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Decide a season's champions: the top-rated 1v1 entrant, and both members of
 * the top-rated 2v2 duo. Pure and total.
 *
 * Ties are broken deterministically rather than left to row order, because two
 * characters really can share a rating and the award must not depend on which
 * one the planner happened to return first: 1v1 falls through rating, then
 * lifetime wins, then bouts fought this season, then name; the pair falls
 * through combined rating, then bouts fought together, then the pair's names.
 *
 * Returns [] for a season with no authored record (the calendar outruns the
 * content roster by design) and simply omits a bracket nobody contested.
 */
export function pickArenaSeasonChampions(input: ArenaSeasonCandidates): ArenaSeasonAward[] {
  const def = arenaSeasonDef(input.season);
  if (!def) return [];
  const awards: ArenaSeasonAward[] = [];

  const solo = [...input.solo].sort(
    (x, y) => y.rating - x.rating || y.wins - x.wins || y.bouts - x.bouts || byName(x.name, y.name),
  )[0];
  if (solo) {
    awards.push({
      season: input.season,
      bracket: '1v1',
      characterId: solo.characterId,
      accountId: solo.accountId,
      deedId: def.deedId,
      rating: solo.rating,
      name: solo.name,
    });
  }

  const pair = [...input.pairs].sort((x, y) => {
    const xr = x.a.rating + x.b.rating;
    const yr = y.a.rating + y.b.rating;
    if (xr !== yr) return yr - xr;
    if (x.bouts !== y.bouts) return y.bouts - x.bouts;
    return comparePairNames(x, y);
  })[0];
  if (pair) {
    for (const member of [pair.a, pair.b]) {
      awards.push({
        season: input.season,
        bracket: '2v2',
        characterId: member.characterId,
        accountId: member.accountId,
        deedId: def.deedId,
        rating: member.rating,
        name: member.name,
      });
    }
  }
  return awards;
}

/**
 * The final tie-break between two duos: compare their sorted name pairs
 * element by element.
 *
 * Element-wise rather than joining the two names into one key on purpose. A
 * joined key needs a separator that can never occur inside a name, which is
 * both an assumption about the name charset and (as the first version of this
 * function proved) an invitation to put a control character in source: it
 * shipped a raw U+0000, which made git treat the whole module as binary and its
 * diff unreviewable. Comparing the elements needs no separator at all.
 */
function comparePairNames(x: ArenaSeasonPairCandidate, y: ArenaSeasonPairCandidate): number {
  const xs = [x.a.name, x.b.name].sort(byName);
  const ys = [y.a.name, y.b.name].sort(byName);
  return byName(xs[0], ys[0]) || byName(xs[1], ys[1]);
}

/**
 * The oldest season whose participation rows the settlement may still need, and
 * therefore the retention floor: anything STRICTLY older than this is safe to
 * prune.
 *
 * This must not be the LIVE season. A season that has just closed is strictly
 * older than the live one, so a floor of "live" makes the rows of a
 * closed-but-unsettled season eligible the instant the boundary passes. On the
 * default config the sweep hour sits hours after the boundary and the 5-minute
 * settler always wins, but two reachable cases lose the race: a sweep hour of 0
 * (its 60-second poll beats the settler on the first of the month), and the
 * catch-up path the design explicitly supports (a realm booting after the sweep
 * hour, settling several seasons through two heavy candidate queries each,
 * while the sweep's first poll lands 60 seconds in). Either way that season
 * would settle with zero champions and stamp its exactly-once marker, so the
 * title would be gone permanently and silently.
 *
 * An UNAUTHORED closed season is skipped rather than held, and that arm is what
 * keeps the floor from freezing. The settler skips such a season without writing
 * a marker (`runOnce`), so it stays unsettled forever; holding the floor at it
 * would pin retention permanently the moment the calendar outruns the roster, and
 * the entrant and pair rows for every season from there on would grow without
 * bound. Skipping is safe because an unauthored season can never be ranked at
 * all: there is no deed to award, so nothing will ever read its rows.
 *
 * The trade that buys: authoring a title for an ALREADY-CLOSED season no longer
 * settles it against real standings, because the rows may be gone by then. That
 * is the right way round. Retroactively titling a season players fought without
 * one was never a supported operation, the roster is authored years ahead
 * precisely so it does not come up, and the settler now says so loudly the first
 * time it skips one (`runOnce`).
 *
 * Pure, so the ordering is testable without a database or a clock.
 */
export function oldestUnsettledArenaSeason(nowMs: number, settled: ReadonlySet<number>): number {
  const lastClosed = lastClosedArenaSeasonAt(nowMs);
  for (let season = 1; season <= lastClosed; season++) {
    if (settled.has(season)) continue;
    if (!arenaSeasonDef(season)) continue;
    return season;
  }
  // Nothing outstanding: only the live season's rows are still being written.
  return arenaSeasonIndexAt(nowMs);
}

/** Everything the driver needs, injected so the whole thing unit-tests. */
export interface ArenaSeasonSettlerDeps {
  realm: string;
  /** The wall clock. Injected so tests drive season boundaries directly. */
  now(): number;
  /** Poll cadence override (tests). */
  pollMs?: number;
  settledSeasons(realm: string): Promise<Set<number>>;
  soloCandidates(realm: string, season: number): Promise<ArenaSeasonSoloCandidate[]>;
  pairCandidates(realm: string, season: number): Promise<ArenaSeasonPairCandidate[]>;
  commit(realm: string, season: number, awards: readonly ArenaSeasonAward[]): Promise<boolean>;
  /**
   * Called ONLY after a commit this process won, so a champion who is online at
   * the boundary is granted their title in place instead of on their next
   * login. Optional: the ledger is the source of truth and the join lane
   * replays it regardless, so a host that wires nothing here loses no award.
   * Never called for a season a peer settled: that peer notifies its own
   * players, and this process would be re-granting on stale reads.
   */
  onAwarded?(awards: readonly ArenaSeasonAward[]): void;
  /** One line per settled season (or per skipped one), the observability contract. */
  onInfo(line: string): void;
  onError(err: unknown): void;
}

export interface ArenaSeasonSettler {
  start(): void;
  stop(): void;
  /** Settle every closed, unsettled season now. Returns the seasons committed. */
  runOnce(): Promise<number[]>;
}

/**
 * The self-clocked settlement driver. Safe to run on every realm process
 * concurrently: the commit's marker insert is the arbiter, and the loser writes
 * nothing and logs that a peer settled it.
 */
export function createArenaSeasonSettler(deps: ArenaSeasonSettlerDeps): ArenaSeasonSettler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  // Seasons already reported as unauthored. Once the calendar outruns the
  // roster that skip is permanent and the poll is every five minutes, so
  // without this it becomes the loudest line in the log, forever.
  const reportedUnauthored = new Set<number>();

  async function runOnce(): Promise<number[]> {
    // Never overlap with itself: a slow settlement must not be re-entered by the
    // next poll tick and re-read the same candidates.
    if (running) return [];
    running = true;
    const committed: number[] = [];
    try {
      const lastClosed = lastClosedArenaSeasonAt(deps.now());
      if (lastClosed < 1) return committed;
      const settled = await deps.settledSeasons(deps.realm);
      for (let season = 1; season <= lastClosed; season++) {
        if (settled.has(season)) continue;
        if (!arenaSeasonDef(season)) {
          if (!reportedUnauthored.has(season)) {
            reportedUnauthored.add(season);
            // Loud on purpose, and not benign: the skip writes no marker, so the
            // season stays unsettled forever, `oldestUnsettledArenaSeason` steps
            // over it, and the nightly sweep may then prune its entrant and
            // partner rows. Authoring the title AFTER that point can no longer
            // rank it. The roster is the fix, and it has to land before the
            // calendar reaches the season.
            deps.onInfo(
              `arena season ${season} closed with no authored title (src/sim/content/arena_seasons.ts); ` +
                'skipped permanently, no champion will ever be awarded for it, and its participation ' +
                'rows are now prunable: extend the roster before the calendar reaches a season',
            );
          }
          continue;
        }
        const [solo, pairs] = await Promise.all([
          deps.soloCandidates(deps.realm, season),
          deps.pairCandidates(deps.realm, season),
        ]);
        const awards = pickArenaSeasonChampions({ season, solo, pairs });
        const won = await deps.commit(deps.realm, season, awards);
        if (!won) {
          deps.onInfo(`arena season ${season} was settled by a peer process; nothing written`);
          continue;
        }
        committed.push(season);
        // Deliver in place before logging, and never let a delivery fault abort
        // the catch-up loop: the award is already durable at this point.
        if (awards.length > 0 && deps.onAwarded) {
          try {
            deps.onAwarded(awards);
          } catch (err) {
            deps.onError(err);
          }
        }
        deps.onInfo(
          awards.length === 0
            ? `arena season ${season} settled with no champions (no ranked entrants)`
            : `arena season ${season} settled: ${describeAwards(awards)}`,
        );
      }
    } catch (err) {
      deps.onError(err);
    } finally {
      running = false;
    }
    return committed;
  }

  return {
    start(): void {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => void runOnce(), deps.pollMs ?? ARENA_SEASON_POLL_MS);
      // Never hold the process open for a half-yearly boundary.
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
}

/** The settled-season log line's body: one clause per contested bracket. */
function describeAwards(awards: readonly ArenaSeasonAward[]): string {
  return ARENA_SEASON_BRACKETS.map((bracket) => {
    const names = awards.filter((a) => a.bracket === bracket).map((a) => a.name);
    return names.length > 0 ? `${bracket} ${names.join(' + ')}` : null;
  })
    .filter((s): s is string => s !== null)
    .join(', ');
}
