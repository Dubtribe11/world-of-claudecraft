// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

// Shared structural constants (instance-local coordinates, y up, z into the
// dungeon). Values are frozen gameplay contracts: mob spawns and pathing
// assume these exact footprints.
export const DUNGEON_WALL_X = 23; // side wall centreline (|x|)
export const DUNGEON_WALL_HW = 1; // wall half thickness
export const DUNGEON_END_WALL_HW = 24; // front/back wall half width
export const PILLAR_COLLIDER_R = 1.0; // centre-aisle pillar obstacle radius
export const TOMB_HW = 1.1; // wall-side obstacle (sarcophagus/cargo) half extents
export const TOMB_HD = 2.1;
export const DUNGEON_WALL_HEIGHT = 8; // visual module height (2x KayKit 4u walls)

export interface GridPoint {
  x: number;
  z: number;
}

export interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DungeonLayout {
  /** front wall centreline (entrance end) */
  zMin: number;
  /** back wall centreline (boss end) */
  zMax: number;
  /** side-wall collider slab (matches the legacy hand-authored extents) */
  sideWallZ: number;
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// The Hollow Crypt / Sunken Bastion room (both DungeonDef.interior 'crypt'):
// one long nave, z -19..112, pillar rows at +-14, sarcophagi at +-19.
export const CRYPT_LAYOUT: DungeonLayout = {
  zMin: -19,
  zMax: 112,
  sideWallZ: 47,
  sideWallHd: 66,
  pillars: grid(10, 100, 15, [-14, 14]),
  tombs: grid(16, 92, 19, [-19, 19]),
  stubs: [],
  dais: { x: 0, z: 96, r: 9.5 },
};

// Gravewyrm Sanctum: a stretched three-chamber crypt (z -19..158) with
// narrowed waists at z 67/115 leaving a ~10u centre passage at |x| <= 5.
export const SANCTUM_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 67, hw: 9, hd: 5 }); // Boneworks -> Korgath's Hall
    stubs.push({ x: sx, z: 115, hw: 9, hd: 3 }); // Ritual Vault -> Wyrm's Hollow
  }
  return {
    zMin: -19,
    zMax: 158,
    sideWallZ: 69.5,
    sideWallHd: 89,
    pillars,
    tombs: [],
    stubs,
    dais: { x: 0, z: 146, r: 11.5 },
  };
})();

// The Drowned Temple (interior 'temple'): a two-part flooded temple — a long
// antechamber, a single chamber-waist arch at z 66 (10u centre passage), then
// the moon-sanctum with Ysolei's great altar dais. Side walls at |x|=23 like
// the crypt so the KayKit wall modules fit unchanged; wall-side slots carry
// drowned reliquary altars instead of sarcophagi.
export const TEMPLE_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 80, 95, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 66, hw: 9, hd: 4 }); // antechamber -> moon-sanctum
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 75.5,
    pillars,
    tombs: grid(18, 40, 22, [-19, 19]), // reliquary altars hugging the antechamber walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
  };
})();

// The Ashen Coliseum (interior 'arena'): a compact, fully-enclosed square pit
// — no door, no aisle (combatants are teleported in by matchmaking). Side
// walls at |x|=23 like the crypt so the KayKit wall modules fit unchanged;
// four corner pillars carry the arena's warm torches. The dais marker only
// drives the central floor glow (the renderer skips its platform for the
// arena), so it stays a flat, obstacle-free fighting ring.
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -20,
  zMax: 24,
  sideWallZ: 2,
  sideWallHd: 23,
  pillars: [
    { x: -14, z: -10 }, { x: 14, z: -10 },
    { x: -14, z: 14 }, { x: 14, z: 14 },
  ],
  tombs: [],
  stubs: [],
  dais: { x: 0, z: 2, r: 8 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other.
export const ARENA_SPAWN_A = { x: 0, z: -14, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 18, facing: Math.PI }; // faces -z toward A

// ---------------------------------------------------------------------------
// The Abyssal Maw (interior 'underworld'): the 10-player raid. Deliberately
// NOTHING like the straight-nave crypt/temple — a wide molten cavern whose only
// safe ground snakes WEST -> EAST -> WEST -> EAST around four lakes of lava
// before the final bridge onto the Devourer's central throne island. The lava
// is walkable but lethal (sim applies a burning DoT, see Sim.updateLavaHazard),
// so the switchback is enforced by lethality, not walls: collision is just the
// outer cavern shell plus obsidian-shard obstacles. Far wider than |x|=23, so
// it does NOT reuse the KayKit nave geometry — the renderer builds it custom.
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface UnderworldLayout {
  /** playable rectangle (inner faces of the perimeter walls) */
  bounds: Rect;
  /** molten lakes: walkable but lethal, and drawn as emissive lava planes */
  lava: Rect[];
  /** obsidian-shard obstacles (collider circles + render) */
  pillars: GridPoint[];
  /** brazier/soul-fire anchors (render: flame mesh + point light), no collider */
  torches: GridPoint[];
  /** the Devourer's throne island centre (render dais + central floor glow) */
  dais: { x: number; z: number; r: number };
}

export const UNDERWORLD_WALL_HW = 1; // perimeter wall half-thickness
export const UNDERWORLD_PILLAR_R = 1.3; // obsidian shard obstacle radius

// Serpentine of lethal lakes. Each lake juts from one wall so the only dry
// ground is a ~32u lane hugging the opposite wall; the open turn-strips between
// bands let the raid swap sides. Boss arenas sit in the lanes; the finale is the
// central island ringed by lava at the bottom.
export const UNDERWORLD_LAYOUT: UnderworldLayout = {
  bounds: { x0: -50, x1: 50, z0: -8, z1: 206 },
  lava: [
    { x0: -18, x1: 50, z0: 24, z1: 50 }, // Lake I — juts east, lane runs WEST
    { x0: -50, x1: 18, z0: 64, z1: 90 }, // Lake II — juts west, lane runs EAST
    { x0: -18, x1: 50, z0: 104, z1: 130 }, // Lake III — juts east, lane runs WEST
    { x0: -50, x1: 18, z0: 144, z1: 170 }, // Lake IV — juts west, lane runs EAST
    { x0: -50, x1: -18, z0: 184, z1: 206 }, // throne moat (west)
    { x0: 18, x1: 50, z0: 184, z1: 206 }, // throne moat (east)
  ],
  pillars: [
    { x: -44, z: 30 }, { x: -24, z: 46 }, // west lane I
    { x: 0, z: 57 }, // turn I
    { x: 44, z: 70 }, { x: 24, z: 86 }, // east lane II
    { x: 0, z: 97 }, // turn II
    { x: -44, z: 110 }, { x: -24, z: 126 }, // west lane III
    { x: 0, z: 137 }, // turn III
    { x: 44, z: 150 }, { x: 24, z: 166 }, // east lane IV
    { x: 0, z: 177 }, // throne approach
    { x: -13, z: 189 }, { x: 13, z: 201 }, // throne flanks
  ],
  torches: [
    { x: -16, z: 0 }, { x: 16, z: 0 },
    { x: -49, z: 26 }, { x: -19, z: 48 },
    { x: -30, z: 57 }, { x: 30, z: 57 },
    { x: 49, z: 66 }, { x: 19, z: 88 },
    { x: -30, z: 97 }, { x: 30, z: 97 },
    { x: -49, z: 106 }, { x: -19, z: 128 },
    { x: -30, z: 137 }, { x: 30, z: 137 },
    { x: 49, z: 146 }, { x: 19, z: 168 },
    { x: -30, z: 177 }, { x: 30, z: 177 },
    { x: -17, z: 186 }, { x: 17, z: 186 }, { x: -17, z: 204 }, { x: 17, z: 204 },
  ],
  dais: { x: 0, z: 195, r: 11 },
};

/** Interior colliders for the Abyssal Maw: the outer shell + obsidian shards.
 *  Lava is intentionally NOT a collider — it's walkable but lethal. */
export function underworldColliders(l: UnderworldLayout): Collider[] {
  const out: Collider[] = [];
  const { x0, x1, z0, z1 } = l.bounds;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const hwX = (x1 - x0) / 2, hdZ = (z1 - z0) / 2;
  const W = UNDERWORLD_WALL_HW;
  out.push({ type: 'obb', x: x0 - W, z: cz, hw: W, hd: hdZ + W, rot: 0 }); // west wall
  out.push({ type: 'obb', x: x1 + W, z: cz, hw: W, hd: hdZ + W, rot: 0 }); // east wall
  out.push({ type: 'obb', x: cx, z: z0 - W, hw: hwX + W, hd: W, rot: 0 }); // front wall
  out.push({ type: 'obb', x: cx, z: z1 + W, hw: hwX + W, hd: W, rot: 0 }); // back wall
  for (const p of l.pillars) out.push({ type: 'circle', x: p.x, z: p.z, r: UNDERWORLD_PILLAR_R });
  return out;
}

/** True when an instance-local point lies in a molten lake (lethal ground). */
export function inUnderworldLava(l: UnderworldLayout, x: number, z: number): boolean {
  for (const r of l.lava) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
  }
  return false;
}

/** Interior collision set for a layout, in instance-local coordinates. */
export function layoutColliders(layout: DungeonLayout): Collider[] {
  const out: Collider[] = [];
  // side walls
  for (const sx of [-DUNGEON_WALL_X, DUNGEON_WALL_X]) {
    out.push({ type: 'obb', x: sx, z: layout.sideWallZ, hw: DUNGEON_WALL_HW, hd: layout.sideWallHd, rot: 0 });
  }
  // back wall, then front wall (entrance porch: chase cam fits inside)
  out.push({ type: 'obb', x: 0, z: layout.zMax, hw: DUNGEON_END_WALL_HW, hd: DUNGEON_WALL_HW, rot: 0 });
  out.push({ type: 'obb', x: 0, z: layout.zMin, hw: DUNGEON_END_WALL_HW, hd: DUNGEON_WALL_HW, rot: 0 });
  // chamber waists
  for (const s of layout.stubs) out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars) out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // wall-side obstacles (the boss dais is walkable: no collider)
  for (const t of layout.tombs) out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  return out;
}
