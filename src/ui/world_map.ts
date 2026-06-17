// Pure geometry for the world-map window's whole-world "overview" view.
// No DOM/canvas here, so it can be unit-tested; the HUD does the drawing and
// the clickable region overlays using these helpers.
//
// The world is a vertical stack of zone bands: each zone owns a z-range while x
// spans the full world width. The overview preserves the world's aspect ratio
// inside the square map canvas, so it renders as a centred vertical "continent"
// strip with the highest-z zone ("north") at the top — matching the minimap and
// the single-zone map, where +Z is up.

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ZoneBand {
  zMin: number;
  zMax: number;
}

/**
 * On-canvas rectangle (for a square canvas of side `S`) for the aspect-preserved
 * whole-world terrain strip. The world is taller than it is wide, so it fits to
 * the full canvas height and is letterboxed horizontally (centred).
 */
export function worldStripRect(S: number, world: MapBounds): { x: number; y: number; w: number; h: number } {
  const spanX = world.maxX - world.minX;
  const spanZ = world.maxZ - world.minZ;
  const w = spanZ > 0 ? S * (spanX / spanZ) : S;
  return { x: (S - w) / 2, y: 0, w, h: S };
}

/**
 * Vertical placement of a zone band as fractions in [0..1] of the overview
 * height, measured from the top (north / max-z). Used to lay out the clickable
 * region overlays over the canvas, so it stays resolution-independent.
 */
export function zoneBandPct(zone: ZoneBand, world: MapBounds): { top: number; height: number } {
  const spanZ = world.maxZ - world.minZ;
  if (spanZ <= 0) return { top: 0, height: 1 };
  return {
    top: (world.maxZ - zone.zMax) / spanZ,
    height: (zone.zMax - zone.zMin) / spanZ,
  };
}
