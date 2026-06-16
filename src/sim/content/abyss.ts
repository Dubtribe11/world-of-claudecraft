// The Abyssal Maw — the underworld. A self-contained 10-player raid (level 20,
// the hardest content in the game), reached through a fiery rift that tore open
// beneath the Gravewyrm Sanctum when Velkhar's seal broke. Its own molten
// hellscape interior (DungeonDef.interior 'underworld'), its own demon/undead
// roster, its own best-in-slot epics — drops you can't get anywhere else.
//
// Unlike every other instance (a straight crypt/temple nave), the Maw is a wide
// cavern whose only dry ground snakes WEST -> EAST -> WEST -> EAST around four
// lakes of lethal lava before the final bridge onto the Devourer's throne
// island (see UNDERWORLD_LAYOUT in sim/dungeon_layout.ts). Every boss telegraphs
// its big mechanics (bossWarning banners + Void Zone warning rings) so a sharp
// group of 10 can survive what would otherwise be unsurvivable.
//
// Merged into the flat engine tables by sim/data.ts, exactly like content/
// dungeons.ts and content/temple.ts.

import type { DungeonDef, DungeonSpawn, ItemDef, MobTemplate, PlayerClass } from '../types';

// Archetype class-locks (match content/items.ts so any group of 10 can use the
// drops). WAR = str/sta plate, MAG = int/spi cloth, ROG = agi/sta leather.
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// ---------------------------------------------------------------------------
// Mobs — the Abyssal Maw (10-player raid). Trash is elite; bosses are CC-immune
// and tuned a clear notch above the Gravewyrm Sanctum (the previous L20 finale)
// for twice the group size.
// ---------------------------------------------------------------------------

export const ABYSS_MOBS: Record<string, MobTemplate> = {
  // -- trash --
  charred_revenant: {
    id: 'charred_revenant', name: 'Charred Revenant', minLevel: 20, maxLevel: 20, family: 'undead', elite: true,
    hpBase: 70, hpPerLevel: 24, dmgBase: 13, dmgPerLevel: 2.7, attackSpeed: 2.2,
    armorPerLevel: 22, moveSpeed: 7, aggroRadius: 12,
    corrode: { chance: 0.25, armor: 150, maxStacks: 4, duration: 18, name: 'Smoldering Armor', school: 'fire' },
    loot: [{ copper: 600, chance: 1 }, { itemId: 'abyssal_cinder', chance: 0.5 }],
    scale: 1.1, color: 0x3a2a2a,
  },
  abyssal_imp: {
    id: 'abyssal_imp', name: 'Abyssal Imp', minLevel: 20, maxLevel: 20, family: 'demon', elite: true,
    hpBase: 60, hpPerLevel: 20, dmgBase: 12, dmgPerLevel: 2.6, attackSpeed: 1.8,
    armorPerLevel: 14, moveSpeed: 8, aggroRadius: 13,
    loot: [{ copper: 600, chance: 1 }, { itemId: 'abyssal_cinder', chance: 0.5 }],
    scale: 1.0, color: 0xc23a1f,
  },
  molten_shambler: {
    id: 'molten_shambler', name: 'Molten Shambler', minLevel: 20, maxLevel: 20, family: 'elemental', elite: true,
    hpBase: 84, hpPerLevel: 26, dmgBase: 14, dmgPerLevel: 2.8, attackSpeed: 2.6,
    armorPerLevel: 26, moveSpeed: 6, aggroRadius: 12,
    aoePulse: { min: 22, max: 34, radius: 8, every: 6, name: 'Molten Spatter', school: 'fire', fx: 'nova' },
    loot: [{ copper: 650, chance: 1 }, { itemId: 'abyssal_cinder', chance: 0.6 }],
    scale: 1.2, color: 0xff5a18,
  },
  soulflame_wraith: {
    id: 'soulflame_wraith', name: 'Soulflame Wraith', minLevel: 20, maxLevel: 20, family: 'undead', elite: true,
    hpBase: 64, hpPerLevel: 22, dmgBase: 13, dmgPerLevel: 2.7, attackSpeed: 2.0,
    armorPerLevel: 16, moveSpeed: 7.5, aggroRadius: 13,
    mortalStrike: { chance: 0.25, healReduction: 0.5, duration: 6, name: 'Soulrend' },
    loot: [{ copper: 620, chance: 1 }, { itemId: 'abyssal_cinder', chance: 0.5 }],
    scale: 1.05, color: 0x7a3fb0,
  },

  // -- summoned adds (no loot) --
  risen_thrall: {
    id: 'risen_thrall', name: 'Risen Thrall', minLevel: 20, maxLevel: 20, family: 'undead',
    hpBase: 42, hpPerLevel: 15, dmgBase: 9, dmgPerLevel: 2.2, attackSpeed: 2.0,
    armorPerLevel: 12, moveSpeed: 7, aggroRadius: 12,
    loot: [], scale: 1.0, color: 0x6a5a4a,
  },
  pit_broodling: {
    id: 'pit_broodling', name: 'Pit Broodling', minLevel: 20, maxLevel: 20, family: 'spider',
    hpBase: 40, hpPerLevel: 14, dmgBase: 9, dmgPerLevel: 2.2, attackSpeed: 1.8,
    armorPerLevel: 10, moveSpeed: 8.5, aggroRadius: 12,
    venom: { chance: 0.3, perTick: 14, interval: 2, duration: 8, name: 'Broodling Venom', school: 'nature' },
    loot: [], scale: 0.85, color: 0x2e7d32,
  },
  tormented_soul: {
    id: 'tormented_soul', name: 'Tormented Soul', minLevel: 20, maxLevel: 20, family: 'undead',
    hpBase: 38, hpPerLevel: 13, dmgBase: 10, dmgPerLevel: 2.3, attackSpeed: 1.9,
    armorPerLevel: 8, moveSpeed: 8, aggroRadius: 12,
    loot: [], scale: 0.95, color: 0x9b59b6,
  },

  // -- Boss 1: the Gatekeeper (tank & positioning) --
  gorehoof_the_charwarden: {
    id: 'gorehoof_the_charwarden', name: 'Gorehoof the Charwarden', minLevel: 20, maxLevel: 20, family: 'ogre',
    elite: true, boss: true, ccImmune: true,
    hpBase: 720, hpPerLevel: 55, dmgBase: 17, dmgPerLevel: 3.2, attackSpeed: 2.6,
    armorPerLevel: 32, moveSpeed: 7, aggroRadius: 16,
    stomp: { radius: 11, every: 13, duration: 2, min: 80, max: 120, name: 'Cinder Stomp', school: 'fire' },
    cleave: { radius: 9, mult: 0.7, name: 'Molten Cleave' },
    corrode: { chance: 0.35, armor: 220, maxStacks: 5, duration: 20, name: 'Charblood', school: 'fire' },
    enrage: { belowHpPct: 0.20, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 8000, chance: 1 },
      { itemId: 'abyssal_cinder', chance: 1 },
      // guaranteed: the raid feet set (weights sum to 1.0 -> always exactly one)
      { itemId: 'emberforged_greaves', chance: 0.34, rollGroup: 'gorehoof_armor' },
      { itemId: 'cinderweave_sandals', chance: 0.33, rollGroup: 'gorehoof_armor' },
      { itemId: 'ashstalker_treads', chance: 0.33, rollGroup: 'gorehoof_armor' },
      // bonus: a chance at a leg piece
      { itemId: 'emberforged_legplates', chance: 0.12, rollGroup: 'gorehoof_bonus' },
      { itemId: 'cinderweave_leggings', chance: 0.12, rollGroup: 'gorehoof_bonus' },
      { itemId: 'ashstalker_legguards', chance: 0.12, rollGroup: 'gorehoof_bonus' },
    ],
    scale: 1.5, color: 0x8a3b1e,
  },

  // -- Boss 2: the Demon (adds + DPS check) --
  malgazzar_the_flameborn: {
    id: 'malgazzar_the_flameborn', name: 'Malgazzar the Flameborn', minLevel: 20, maxLevel: 20, family: 'demon',
    elite: true, boss: true, ccImmune: true,
    hpBase: 760, hpPerLevel: 56, dmgBase: 17, dmgPerLevel: 3.1, attackSpeed: 2.2,
    armorPerLevel: 26, moveSpeed: 7.5, aggroRadius: 18,
    aoePulse: { min: 60, max: 90, radius: 14, every: 8, name: 'Fel Conflagration', school: 'fire', fx: 'nova' },
    summonAdds: { mobId: 'abyssal_imp', count: 3, atHpPct: [0.66, 0.33] },
    mortalStrike: { chance: 0.3, healReduction: 0.5, duration: 8, name: 'Searing Wound', school: 'fire' },
    loot: [
      { copper: 9000, chance: 1 },
      { itemId: 'abyssal_cinder', chance: 1 },
      // guaranteed: the raid leg set
      { itemId: 'emberforged_legplates', chance: 0.34, rollGroup: 'malgazzar_armor' },
      { itemId: 'cinderweave_leggings', chance: 0.33, rollGroup: 'malgazzar_armor' },
      { itemId: 'ashstalker_legguards', chance: 0.33, rollGroup: 'malgazzar_armor' },
      // bonus: a chance at a feet piece
      { itemId: 'emberforged_greaves', chance: 0.12, rollGroup: 'malgazzar_bonus' },
      { itemId: 'cinderweave_sandals', chance: 0.12, rollGroup: 'malgazzar_bonus' },
      { itemId: 'ashstalker_treads', chance: 0.12, rollGroup: 'malgazzar_bonus' },
    ],
    scale: 1.5, color: 0xff4500,
  },

  // -- Boss 3: the Lich (telegraphed Void Zone showcase + add waves) --
  archlich_vekru: {
    id: 'archlich_vekru', name: 'Archlich Vekru', minLevel: 20, maxLevel: 20, family: 'undead',
    elite: true, boss: true, ccImmune: true,
    hpBase: 800, hpPerLevel: 58, dmgBase: 16, dmgPerLevel: 3.0, attackSpeed: 2.0,
    armorPerLevel: 22, moveSpeed: 7, aggroRadius: 18,
    summonAdds: { mobId: 'risen_thrall', count: 4, atHpPct: [0.75, 0.5, 0.25] },
    aoePulse: { min: 55, max: 80, radius: 13, every: 9, name: 'Necrotic Wave', school: 'shadow', fx: 'nova' },
    voidZone: { every: 16, delay: 4, radius: 7, min: 120, max: 170, name: 'Soul Detonation', warnKey: 'raidWarn.soulDetonation', school: 'shadow' },
    loot: [
      { copper: 10000, chance: 1 },
      { itemId: 'abyssal_cinder', chance: 1 },
      // guaranteed: the raid chest set
      { itemId: 'emberforged_breastplate', chance: 0.34, rollGroup: 'vekru_armor' },
      { itemId: 'cinderweave_robe', chance: 0.33, rollGroup: 'vekru_armor' },
      { itemId: 'ashstalker_jerkin', chance: 0.33, rollGroup: 'vekru_armor' },
      // bonus: a slim chance at a weapon
      { itemId: 'cataclysms_edge', chance: 0.08, rollGroup: 'vekru_bonus' },
      { itemId: 'staff_of_the_devourer', chance: 0.08, rollGroup: 'vekru_bonus' },
      { itemId: 'fang_of_the_abyss', chance: 0.08, rollGroup: 'vekru_bonus' },
    ],
    scale: 1.3, color: 0x6f2dbd,
  },

  // -- Boss 4: the Spider-Queen (poison/spread + Void Zone) --
  broodmother_xalthrea: {
    id: 'broodmother_xalthrea', name: "Broodmother Xal'Threa", minLevel: 20, maxLevel: 20, family: 'spider',
    elite: true, boss: true, ccImmune: true,
    hpBase: 840, hpPerLevel: 60, dmgBase: 18, dmgPerLevel: 3.2, attackSpeed: 1.8,
    armorPerLevel: 24, moveSpeed: 8, aggroRadius: 16,
    venom: { chance: 0.4, perTick: 30, interval: 2, duration: 12, name: 'Abyssal Venom', school: 'nature' },
    summonAdds: { mobId: 'pit_broodling', count: 4, atHpPct: [0.6, 0.3] },
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
    cleave: { radius: 8, mult: 0.6, name: 'Rending Bite' },
    voidZone: { every: 15, delay: 4, radius: 7, min: 110, max: 160, name: 'Caustic Pool', warnKey: 'raidWarn.causticPool', school: 'nature' },
    loot: [
      { copper: 11000, chance: 1 },
      { itemId: 'abyssal_cinder', chance: 1 },
      // guaranteed: a generous mixed cache (one of three slots/archetypes)
      { itemId: 'emberforged_breastplate', chance: 0.34, rollGroup: 'xalthrea_armor' },
      { itemId: 'cinderweave_leggings', chance: 0.33, rollGroup: 'xalthrea_armor' },
      { itemId: 'ashstalker_treads', chance: 0.33, rollGroup: 'xalthrea_armor' },
      // bonus: a slim chance at a weapon
      { itemId: 'cataclysms_edge', chance: 0.08, rollGroup: 'xalthrea_bonus' },
      { itemId: 'staff_of_the_devourer', chance: 0.08, rollGroup: 'xalthrea_bonus' },
      { itemId: 'fang_of_the_abyss', chance: 0.08, rollGroup: 'xalthrea_bonus' },
    ],
    scale: 1.5, color: 0x1e8449,
  },

  // -- Boss 5: Xal'Goreth, the Devourer (two-phase finale, every mechanic) --
  xal_goreth_the_devourer: {
    id: 'xal_goreth_the_devourer', name: "Xal'Goreth, the Devourer", minLevel: 20, maxLevel: 20, family: 'dragonkin',
    elite: true, boss: true, ccImmune: true,
    hpBase: 1200, hpPerLevel: 80, dmgBase: 20, dmgPerLevel: 3.4, attackSpeed: 2.4,
    armorPerLevel: 36, moveSpeed: 7, aggroRadius: 20,
    aoePulse: { min: 80, max: 110, radius: 15, every: 8, name: 'Necrotic Shockwave', school: 'shadow', fx: 'nova' },
    stomp: { radius: 12, every: 14, duration: 2, min: 90, max: 130, name: 'Sundering Roar', school: 'physical' },
    summonAdds: { mobId: 'tormented_soul', count: 4, atHpPct: [0.66, 0.33] },
    voidZone: { every: 12, delay: 4, radius: 8, min: 150, max: 210, name: 'Cataclysm', warnKey: 'raidWarn.cataclysm', school: 'fire' },
    enrage: { belowHpPct: 0.25, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 80000, chance: 1 },
      { itemId: 'abyssal_cinder', chance: 1 },
      // guaranteed: one of the three apex weapons (raid-exclusive best-in-slot)
      { itemId: 'cataclysms_edge', chance: 0.34, rollGroup: 'devourer_weapon' },
      { itemId: 'staff_of_the_devourer', chance: 0.33, rollGroup: 'devourer_weapon' },
      { itemId: 'fang_of_the_abyss', chance: 0.33, rollGroup: 'devourer_weapon' },
      // bonus: a second weapon shot for a lucky raid
      { itemId: 'cataclysms_edge', chance: 0.16, rollGroup: 'devourer_bonus' },
      { itemId: 'staff_of_the_devourer', chance: 0.16, rollGroup: 'devourer_bonus' },
      { itemId: 'fang_of_the_abyss', chance: 0.16, rollGroup: 'devourer_bonus' },
    ],
    scale: 1.9, color: 0xb71c1c,
  },
};

// ---------------------------------------------------------------------------
// Items — raid-exclusive best-in-slot epics (a notch above the Gravewyrm
// Sanctum set), one weapon + chest/legs/feet per archetype, plus a trophy.
// Stats follow the existing archetype identity: WAR str/sta, MAG int/spi,
// ROG agi/sta — nothing off-archetype (no spellpower/AP stats exist).
// ---------------------------------------------------------------------------

export const ABYSS_ITEMS: Record<string, ItemDef> = {
  // -- weapons (Devourer / rare boss bonus) --
  cataclysms_edge: {
    id: 'cataclysms_edge', name: "Cataclysm's Edge", kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 38, max: 58, speed: 2.6 }, stats: { str: 13, sta: 8 }, sellValue: 12000, requiredClass: WAR,
  },
  staff_of_the_devourer: {
    id: 'staff_of_the_devourer', name: 'Staff of the Devourer', kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 40, max: 62, speed: 3.0 }, stats: { int: 16, spi: 8 }, sellValue: 12000, requiredClass: MAG,
  },
  fang_of_the_abyss: {
    id: 'fang_of_the_abyss', name: 'Fang of the Abyss', kind: 'weapon', slot: 'mainhand', quality: 'epic',
    weapon: { min: 23, max: 36, speed: 1.7, dagger: true }, stats: { agi: 14, sta: 7 }, sellValue: 12000, requiredClass: ROG,
  },

  // -- chest --
  emberforged_breastplate: {
    id: 'emberforged_breastplate', name: 'Emberforged Breastplate', kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 300, str: 11, sta: 12 }, sellValue: 11000, requiredClass: WAR,
  },
  cinderweave_robe: {
    id: 'cinderweave_robe', name: 'Cinderweave Robe', kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 105, int: 17, spi: 10 }, sellValue: 11000, requiredClass: MAG,
  },
  ashstalker_jerkin: {
    id: 'ashstalker_jerkin', name: 'Ashstalker Jerkin', kind: 'armor', slot: 'chest', quality: 'epic',
    stats: { armor: 190, agi: 16, sta: 9 }, sellValue: 11000, requiredClass: ROG,
  },

  // -- legs --
  emberforged_legplates: {
    id: 'emberforged_legplates', name: 'Emberforged Legplates', kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 265, str: 10, sta: 11 }, sellValue: 11000, requiredClass: WAR,
  },
  cinderweave_leggings: {
    id: 'cinderweave_leggings', name: 'Cinderweave Leggings', kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 98, int: 16, spi: 9 }, sellValue: 11000, requiredClass: MAG,
  },
  ashstalker_legguards: {
    id: 'ashstalker_legguards', name: 'Ashstalker Legguards', kind: 'armor', slot: 'legs', quality: 'epic',
    stats: { armor: 175, agi: 15, sta: 9 }, sellValue: 11000, requiredClass: ROG,
  },

  // -- feet --
  emberforged_greaves: {
    id: 'emberforged_greaves', name: 'Emberforged Greaves', kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 225, str: 9, sta: 10 }, sellValue: 11000, requiredClass: WAR,
  },
  cinderweave_sandals: {
    id: 'cinderweave_sandals', name: 'Cinderweave Sandals', kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 90, int: 15, spi: 9 }, sellValue: 11000, requiredClass: MAG,
  },
  ashstalker_treads: {
    id: 'ashstalker_treads', name: 'Ashstalker Treads', kind: 'armor', slot: 'feet', quality: 'epic',
    stats: { armor: 160, agi: 14, sta: 8 }, sellValue: 11000, requiredClass: ROG,
  },

  // -- trophy (vendor trash, but valuable) --
  abyssal_cinder: {
    id: 'abyssal_cinder', name: 'Abyssal Cinder', kind: 'junk', quality: 'poor', sellValue: 120,
  },
};

// ---------------------------------------------------------------------------
// Spawn list — instance-local, following the serpentine. Each lane leads with a
// trash pack or two, then its boss with a pair of guards; the throne approach
// gauntlet leads to the Devourer. Coordinates avoid the lava lakes (see
// UNDERWORLD_LAYOUT): WEST lane = x < -18, EAST lane = x > 18, throne x in -18..18.
// ---------------------------------------------------------------------------

const ABYSS_SPAWN_LIST: DungeonSpawn[] = [
  // entry hall
  { mobId: 'charred_revenant', x: -6, z: 12 },
  { mobId: 'charred_revenant', x: 6, z: 14 },
  // west lane I -> Gorehoof
  { mobId: 'abyssal_imp', x: -40, z: 28 },
  { mobId: 'charred_revenant', x: -28, z: 30 },
  { mobId: 'molten_shambler', x: -44, z: 44 },
  { mobId: 'gorehoof_the_charwarden', x: -34, z: 40 },
  { mobId: 'charred_revenant', x: -42, z: 36 },
  { mobId: 'abyssal_imp', x: -26, z: 38 },
  // turn I
  { mobId: 'soulflame_wraith', x: -8, z: 56 },
  { mobId: 'abyssal_imp', x: 8, z: 58 },
  // east lane II -> Malgazzar
  { mobId: 'charred_revenant', x: 40, z: 70 },
  { mobId: 'molten_shambler', x: 28, z: 72 },
  { mobId: 'abyssal_imp', x: 44, z: 84 },
  { mobId: 'malgazzar_the_flameborn', x: 34, z: 78 },
  { mobId: 'abyssal_imp', x: 26, z: 74 },
  { mobId: 'charred_revenant', x: 42, z: 82 },
  // turn II
  { mobId: 'soulflame_wraith', x: -8, z: 96 },
  { mobId: 'molten_shambler', x: 8, z: 98 },
  // west lane III -> Vekru
  { mobId: 'charred_revenant', x: -40, z: 110 },
  { mobId: 'soulflame_wraith', x: -28, z: 112 },
  { mobId: 'abyssal_imp', x: -44, z: 124 },
  { mobId: 'archlich_vekru', x: -34, z: 118 },
  { mobId: 'soulflame_wraith', x: -42, z: 114 },
  { mobId: 'charred_revenant', x: -26, z: 122 },
  // turn III
  { mobId: 'molten_shambler', x: -8, z: 136 },
  { mobId: 'abyssal_imp', x: 8, z: 138 },
  // east lane IV -> Xal'Threa
  { mobId: 'charred_revenant', x: 40, z: 150 },
  { mobId: 'molten_shambler', x: 28, z: 152 },
  { mobId: 'soulflame_wraith', x: 44, z: 164 },
  { mobId: 'broodmother_xalthrea', x: 34, z: 158 },
  { mobId: 'pit_broodling', x: 26, z: 154 },
  { mobId: 'pit_broodling', x: 42, z: 162 },
  // throne approach gauntlet
  { mobId: 'charred_revenant', x: -6, z: 176 },
  { mobId: 'charred_revenant', x: 6, z: 178 },
  { mobId: 'soulflame_wraith', x: 0, z: 182 },
  // the throne — Xal'Goreth
  { mobId: 'xal_goreth_the_devourer', x: 0, z: 196 },
  { mobId: 'soulflame_wraith', x: -10, z: 190 },
  { mobId: 'soulflame_wraith', x: 10, z: 190 },
];

export const ABYSS_DUNGEON_DEFS: Record<string, DungeonDef> = {
  abyssal_maw: {
    id: 'abyssal_maw',
    name: 'The Abyssal Maw',
    index: 4, // instance origin x = 900 + 4*600 = 3300 (clear of the arena band)
    doorPos: { x: 90, z: 888 }, // a fiery rift torn open east of the Sanctum gate
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: ABYSS_SPAWN_LIST,
    interior: 'underworld',
    suggestedPlayers: 10,
    minLevel: 20,
    requiresParty: true,
    enterText: 'The rift drags you down into heat and ash — and far below, something vast draws breath. The Abyssal Maw has opened.',
    leaveText: 'You claw back up through the rift into the cold mountain wind.',
  },
};
