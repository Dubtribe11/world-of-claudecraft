// Pure tests for the mobile Assist button's tap semantics. Every branch is
// asserted twice: the returned outcome AND which callback actually ran, so a
// refactor that returns the right label while calling the wrong seam fails.

import { describe, expect, it, vi } from 'vitest';
import {
  ASSIST_STOP_ATTACK_HOLD_MS,
  type AssistTapActions,
  type AssistTapState,
  isAssistStopAttackHold,
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
    heldMs: 0,
    ...overrides,
  };
}

describe('isAssistStopAttackHold', () => {
  it('is the hold threshold, inclusive', () => {
    expect(isAssistStopAttackHold(ASSIST_STOP_ATTACK_HOLD_MS - 1)).toBe(false);
    expect(isAssistStopAttackHold(ASSIST_STOP_ATTACK_HOLD_MS)).toBe(true);
    expect(isAssistStopAttackHold(0)).toBe(false);
  });

  it('takes an explicit threshold', () => {
    expect(isAssistStopAttackHold(100, 200)).toBe(false);
    expect(isAssistStopAttackHold(250, 200)).toBe(true);
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

  it('stops auto-attack on a long hold while swinging', () => {
    const actions = spies();
    const outcome = resolveAssistTap(
      state({ autoAttack: true, heldMs: ASSIST_STOP_ATTACK_HOLD_MS }),
      actions,
    );
    expect(outcome).toBe('stopAttack');
    expect(actions.activateAttack).toHaveBeenCalledTimes(1);
    expect(actions.castAssist).not.toHaveBeenCalled();
  });

  it('does not eat a long hold that is not stopping anything', () => {
    // Not swinging: a slow press is still a press, not a dead zone.
    const actions = spies();
    const outcome = resolveAssistTap(
      state({ autoAttack: false, heldMs: ASSIST_STOP_ATTACK_HOLD_MS * 3 }),
      actions,
    );
    expect(outcome).toBe('cast');
    expect(actions.castAssist).toHaveBeenCalledWith('fireball');
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
