// Pure tap semantics for the mobile Assist button: ONE press on the touch action
// ring's primary button, four possible meanings, decided here so the HUD only
// has to supply the callbacks.
//
// Why the primary button and not a new seat: the ring is geometrically saturated
// (five paged action slots on an equal-chord quarter arc, plus the Use / Target /
// Jump / page-toggle seats in the crescent hollow; every remaining gap is under
// the 40x40 touch floor). The primary button is also the biggest and best-placed
// target on the cluster, which is exactly what a one-tap rotation wants. With
// Assist off, nothing here runs and the button stays the classic Attack toggle.
//
// The auto-attack toggle is not lost: holding the button stops your swings,
// reusing the same long-press vocabulary the mobile Chat button already uses.

/** Hold the Assist button at least this long (ms) to stop auto-attacking
 *  instead of casting. Matches the mobile Chat button's long-press feel. */
export const ASSIST_STOP_ATTACK_HOLD_MS = 420;

/** A press counts as the stop-attacking hold once held this long. */
export function isAssistStopAttackHold(
  heldMs: number,
  threshold = ASSIST_STOP_ATTACK_HOLD_MS,
): boolean {
  return heldMs >= threshold;
}

export interface AssistTapState {
  /** The ability the assist would cast, or null when the class priority list
   *  yields nothing the player knows (or the player is dead). */
  abilityId: string | null;
  /** Whether that ability needs a living hostile target selected. */
  needsEnemy: boolean;
  hasLiveHostileTarget: boolean;
  autoAttack: boolean;
  /** How long the press was held. 0 for a mouse click or keyboard activation,
   *  which have no hold phase. */
  heldMs: number;
}

export interface AssistTapActions {
  /** Cast the chosen ability (the HUD adds the auto-attack engage + used-flash). */
  castAssist(abilityId: string): void;
  /** Acquire the nearest enemy and start swinging; null when the host wired no
   *  acquire-nearest path (offline builds without it). */
  attackNearest: (() => void) | null;
  /** The classic Attack toggle press (engages, or disengages when swinging). */
  activateAttack(): void;
}

/** Which branch a press took. Returned so a test can assert the DECISION, not
 *  just the side effect. */
export type AssistTapOutcome = 'stopAttack' | 'attackNearest' | 'cast' | 'attackToggle';

/**
 * Resolve one press of the Assist button.
 *
 *   1. A long hold WHILE SWINGING stops auto-attack (the toggle-off the button
 *      would otherwise no longer offer). A long hold while not swinging is not a
 *      dead press: it falls through and casts like a tap.
 *   2. With no ability to cast, the press behaves exactly like the classic Attack
 *      button, so Assist never leaves the biggest button on the screen inert.
 *   3. An offensive pick with nothing selected acquires the nearest enemy first
 *      (and starts swinging), the same first tap the classic button does. The
 *      next tap casts.
 *   4. Otherwise: cast the pick.
 */
export function resolveAssistTap(
  state: AssistTapState,
  actions: AssistTapActions,
): AssistTapOutcome {
  if (state.autoAttack && isAssistStopAttackHold(state.heldMs)) {
    actions.activateAttack();
    return 'stopAttack';
  }
  const classicTap = (): AssistTapOutcome => {
    if (!state.autoAttack && !state.hasLiveHostileTarget && actions.attackNearest) {
      actions.attackNearest();
      return 'attackNearest';
    }
    actions.activateAttack();
    return 'attackToggle';
  };
  if (state.abilityId === null) return classicTap();
  if (state.needsEnemy && !state.hasLiveHostileTarget) return classicTap();
  actions.castAssist(state.abilityId);
  return 'cast';
}
