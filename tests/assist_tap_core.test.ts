// Pure tests for the mobile Assist button's tap semantics. Every branch is
// asserted twice: the returned outcome AND which callback actually ran, so a
// refactor that returns the right label while calling the wrong seam fails.

import { describe, expect, it, vi } from 'vitest';
import {
  ASSIST_STOP_ATTACK_HOLD_MS,
  type AssistTapActions,
  type AssistTapState,
  resolveAssistTap,
} from '../src/ui/hud/action_bar/assist_tap_core';

function spies(overrides: Partial<AssistTapActions> = {}) {
  const actions = {
    castAssist: vi.fn(),
    attackNearest: vi.fn(),
    activateAttack: vi.fn(),
    ...overrides,
  };
  return actions as AssistTapActions & {
    castAssist: ReturnType<typeof vi.fn>;
    attackNearest: ReturnType<typeof vi.fn> | null;
    activateAttack: ReturnType<typeof vi.fn>;
  };
}

function state(overrides: Partial<AssistTapState> = {}): AssistTapState {
  return {
    abilityId: 'fireball',
    needsEnemy: true,
    hasLiveHostileTarget: true,
    autoAttack: false,
    stopAttackHold: false,
    ...overrides,
  };
}

describe('ASSIST_STOP_ATTACK_HOLD_MS', () => {
  it('is a DELIBERATE press-and-hold, past the mobile context menu long-press', () => {
    // The regression this pins: the gesture used to sit at 420ms and be classified
    // from a duration measured at pointerup, so main-thread jank made an instant
    // tap read as a long press and stopped the player's swings instead of casting.
    // The binding now fires it from a timer (ui/touch_tap.ts TouchHoldSpec), and
    // the threshold has to stay clear of any plausible tap for that to be safe.
    expect(ASSIST_STOP_ATTACK_HOLD_MS).toBeGreaterThan(650);
  });
});

describe('resolveAssistTap', () => {
  it('casts the pick on an ordinary tap', () => {
    const actions = spies();
    expect(resolveAssistTap(state(), actions)).toBe('cast');
    expect(actions.castAssist).toHaveBeenCalledWith('fireball');
    expect(actions.activateAttack).not.toHaveBeenCalled();
    expect(actions.attackNearest).not.toHaveBeenCalled();
  });

  it('stops auto-attack on the hold while swinging', () => {
    const actions = spies();
    const outcome = resolveAssistTap(state({ autoAttack: true, stopAttackHold: true }), actions);
    expect(outcome).toBe('stopAttack');
    expect(actions.activateAttack).toHaveBeenCalledTimes(1);
    expect(actions.castAssist).not.toHaveBeenCalled();
  });

  it('does not eat the hold when it is not stopping anything', () => {
    // Not swinging: the hold is still a press, not a dead zone.
    const actions = spies();
    const outcome = resolveAssistTap(state({ autoAttack: false, stopAttackHold: true }), actions);
    expect(outcome).toBe('cast');
    expect(actions.castAssist).toHaveBeenCalledWith('fireball');
  });

  it('CASTS a tap taken mid-fight, however sluggish the press felt', () => {
    // The reported bug, at the core's own layer: with auto-attack on for the whole
    // fight, a TAP must still cast. Only the timer-fired hold may stop the swings,
    // so a tap arrives here with stopAttackHold false no matter how long the finger
    // was actually down, and every combat press casts.
    const actions = spies();
    const outcome = resolveAssistTap(state({ autoAttack: true, stopAttackHold: false }), actions);
    expect(outcome).toBe('cast');
    expect(actions.castAssist).toHaveBeenCalledWith('fireball');
    expect(actions.activateAttack).not.toHaveBeenCalled();
  });

  it('acquires the nearest enemy when an offensive pick has nothing selected', () => {
    const actions = spies();
    const outcome = resolveAssistTap(
      state({ hasLiveHostileTarget: false, needsEnemy: true }),
      actions,
    );
    expect(outcome).toBe('attackNearest');
    expect(actions.attackNearest).toHaveBeenCalledTimes(1);
    expect(actions.castAssist).not.toHaveBeenCalled();
  });

  it('casts a pick that needs no enemy even with nothing selected', () => {
    const actions = spies();
    const outcome = resolveAssistTap(
      state({ abilityId: 'battle_shout', needsEnemy: false, hasLiveHostileTarget: false }),
      actions,
    );
    expect(outcome).toBe('cast');
    expect(actions.castAssist).toHaveBeenCalledWith('battle_shout');
    expect(actions.attackNearest).not.toHaveBeenCalled();
  });

  it('falls back to the classic attack press when there is no pick at all', () => {
    const withTarget = spies();
    expect(resolveAssistTap(state({ abilityId: null }), withTarget)).toBe('attackToggle');
    expect(withTarget.activateAttack).toHaveBeenCalledTimes(1);

    const without = spies();
    expect(resolveAssistTap(state({ abilityId: null, hasLiveHostileTarget: false }), without)).toBe(
      'attackNearest',
    );
    expect(without.attackNearest).toHaveBeenCalledTimes(1);
  });

  it('toggles attack rather than acquiring when already swinging with nothing selected', () => {
    // Mirrors the classic button: acquire-nearest is only the FIRST press.
    const actions = spies();
    const outcome = resolveAssistTap(
      state({ abilityId: null, hasLiveHostileTarget: false, autoAttack: true }),
      actions,
    );
    expect(outcome).toBe('attackToggle');
    expect(actions.activateAttack).toHaveBeenCalledTimes(1);
    expect(actions.attackNearest).not.toHaveBeenCalled();
  });

  it('toggles attack when no acquire-nearest path is wired', () => {
    const actions = spies({ attackNearest: null });
    const outcome = resolveAssistTap(state({ hasLiveHostileTarget: false }), actions);
    expect(outcome).toBe('attackToggle');
    expect(actions.activateAttack).toHaveBeenCalledTimes(1);
  });
});
