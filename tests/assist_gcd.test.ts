// The assist global-cooldown tax: the pure math, plus the shape guarantees the
// balance argument rests on (never faster than a manual press, haste still
// proportional, tuning-value independent).

import { describe, expect, it } from 'vitest';
import { ASSIST_GCD_PENALTY_MULT, assistedGcd } from '../src/sim/combat/assist_gcd';

describe('assistedGcd', () => {
  it('leaves a manual cast untouched', () => {
    expect(assistedGcd(1.5, false)).toBe(1.5);
    expect(assistedGcd(0.75, false)).toBe(0.75);
  });

  it('taxes an assisted cast by the penalty multiplier', () => {
    expect(assistedGcd(1.5, true)).toBeCloseTo(1.5 * ASSIST_GCD_PENALTY_MULT, 10);
  });

  it('is STRICTLY slower than the manual value, at the shipped tuning', () => {
    // The whole point of the feature's balance story: a hands-off rotation may
    // never come out as fast as one driven by hand. Asserted against the shipped
    // constant so re-tuning it below 1 fails here instead of silently inverting.
    expect(ASSIST_GCD_PENALTY_MULT).toBeGreaterThan(1);
    expect(assistedGcd(1.5, true)).toBeGreaterThan(assistedGcd(1.5, false));
  });

  it('scales with the base, so haste keeps helping proportionally', () => {
    // 33% haste halves nothing about the tax: the taxed GCD stays the same ratio
    // above the manual one, which is why the tax is applied AFTER haste.
    const slow = assistedGcd(1.5, true) / 1.5;
    const hasted = assistedGcd(1.1, true) / 1.1;
    expect(hasted).toBeCloseTo(slow, 10);
  });

  it('clamps a mult below 1, so a bad tuning value cannot make the assist FASTER', () => {
    expect(assistedGcd(1.5, true, 0.5)).toBe(1.5);
    expect(assistedGcd(1.5, true, 1)).toBe(1.5);
    expect(assistedGcd(1.5, true, 2)).toBe(3);
  });

  it('takes an explicit mult, so the math is pinned without the tuning value', () => {
    expect(assistedGcd(2, true, 1.5)).toBe(3);
    expect(assistedGcd(2, false, 1.5)).toBe(2);
  });
});
