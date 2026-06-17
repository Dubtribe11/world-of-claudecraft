import { describe, it, expect } from 'vitest';
import { worldStripRect, zoneBandPct, type MapBounds, type ZoneBand } from '../src/ui/world_map';

// The shipped world: x spans [-180, 180] (width 360), z spans [-180, 900]
// (height 1080) across three stacked zone bands.
const WORLD: MapBounds = { minX: -180, maxX: 180, minZ: -180, maxZ: 900 };
const NORTH: ZoneBand = { zMin: 540, zMax: 900 }; // top of the overview
const MIDDLE: ZoneBand = { zMin: 180, zMax: 540 };
const SOUTH: ZoneBand = { zMin: -180, zMax: 180 }; // bottom of the overview

describe('worldStripRect', () => {
  it('fits the taller-than-wide world to canvas height, letterboxed horizontally', () => {
    const S = 560;
    const r = worldStripRect(S, WORLD);
    expect(r.y).toBe(0);
    expect(r.h).toBe(560);
    expect(r.w).toBeCloseTo(560 * (360 / 1080), 5); // aspect-preserved width
    expect(r.x).toBeCloseTo((560 - r.w) / 2, 5); // centred
    expect(r.w).toBeLessThan(S); // narrower than the canvas → side letterbox
  });
});

describe('zoneBandPct', () => {
  it('puts the highest-z zone at the top and the lowest at the bottom', () => {
    expect(zoneBandPct(NORTH, WORLD).top).toBeCloseTo(0, 5);
    expect(zoneBandPct(MIDDLE, WORLD).top).toBeCloseTo(1 / 3, 5);
    expect(zoneBandPct(SOUTH, WORLD).top).toBeCloseTo(2 / 3, 5);
  });

  it('sizes each band by its share of the world z-span', () => {
    for (const band of [NORTH, MIDDLE, SOUTH]) {
      expect(zoneBandPct(band, WORLD).height).toBeCloseTo(1 / 3, 5);
    }
  });

  it('tiles the full height with no gaps or overlaps', () => {
    const bands = [NORTH, MIDDLE, SOUTH].map((b) => zoneBandPct(b, WORLD));
    expect(bands.reduce((sum, b) => sum + b.height, 0)).toBeCloseTo(1, 5);
    // each band's bottom meets the next band's top
    expect(bands[0].top + bands[0].height).toBeCloseTo(bands[1].top, 5);
    expect(bands[1].top + bands[1].height).toBeCloseTo(bands[2].top, 5);
  });
});
