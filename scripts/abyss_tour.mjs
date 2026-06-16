// Screenshot tour of The Abyssal Maw (10-player underworld raid).
// Boots the offline game, claims a Maw instance (so all bosses spawn), and
// shoots the lava cavern + each of the five bosses, then a live combat frame
// to catch a raid-warning banner / void-zone telegraph.
// Needs `npm run dev` on :5173 and BROWSER_PATH set to a Chromium binary.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const OUT = 'tmp/abyss';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

console.log('booting offline...');
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.click('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Ashveil');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await sleep(3500);

console.log('claiming the Abyssal Maw...');
const origin = await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player;
  p.level = 20; p.maxHp = 1e7; p.hp = 1e7;
  const inst = sim.instances.find((i) => i.dungeonId === 'abyssal_maw' && i.partyKey === null);
  if (!inst) throw new Error('no free abyssal_maw instance slot');
  sim.claimInstance(inst, 'solo:' + p.id);     // spawns every boss + trash
  const o = sim.instanceOriginOf(inst);
  window.__o = o;
  p.pos.x = o.x; p.pos.z = o.z + 6; p.prevPos = { x: p.pos.x, z: p.pos.z };
  sim.rebucket && sim.rebucket(p);
  return o;
});
console.log('instance origin', origin);
await sleep(4000); // ensureDungeonAssets (lazy KayKit load) + interior build

// Position the camera from instance-LOCAL coords and look at a local target.
async function cam(name, lx, lz, lookLx, lookLz, dist = 13, pitch = 0.34) {
  await page.evaluate((lx, lz, lookLx, lookLz, dist, pitch) => {
    const g = window.__game, sim = g.sim, p = sim.player, o = window.__o;
    p.maxHp = 1e7; p.hp = 1e7;
    p.pos.x = o.x + lx; p.pos.z = o.z + lz; p.prevPos = { x: p.pos.x, z: p.pos.z };
    p.facing = Math.atan2((o.x + lookLx) - p.pos.x, (o.z + lookLz) - p.pos.z);
    g.input.camYaw = p.facing; g.input.camPitch = pitch; g.input.camDist = dist;
    sim.rebucket && sim.rebucket(p);
  }, lx, lz, lookLx, lookLz, dist, pitch);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

// Portrait of a boss: find it live, stand `back` yds in front toward the entry.
async function bossCam(name, tid, dist = 11, pitch = 0.33, back = 9) {
  const ok = await page.evaluate((tid, dist, pitch, back) => {
    const g = window.__game, sim = g.sim, p = sim.player, o = window.__o;
    p.maxHp = 1e7; p.hp = 1e7;
    let boss = null;
    for (const e of sim.entities.values()) if (e.templateId === tid && !e.dead) boss = e;
    if (!boss) return false;
    const cx = boss.pos.x + (boss.pos.x > o.x ? -1 : 1) * back * 0.45;
    const cz = boss.pos.z - back;
    p.pos.x = cx; p.pos.z = cz; p.prevPos = { x: cx, z: cz };
    p.facing = Math.atan2(boss.pos.x - cx, boss.pos.z - cz);
    g.input.camYaw = p.facing; g.input.camPitch = pitch; g.input.camDist = dist;
    sim.targetEntity && sim.targetEntity(boss.id);
    sim.rebucket && sim.rebucket(p);
    return true;
  }, tid, dist, pitch, back);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name, ok ? '' : '(BOSS NOT FOUND)');
}

// --- the tour ---
await cam('a00_entrance', 0, 10, 0, 80, 20, 0.52);          // wide cavern from the entry rift
await cam('a01_lava_west', -10, 50, -42, 40, 19, 0.46);     // west lava lane / bridge
await cam('a02_lava_east', 10, 90, 42, 78, 19, 0.46);       // east lava lane / bridge
await bossCam('a03_gorehoof', 'gorehoof_the_charwarden', 12, 0.32, 10);
await bossCam('a04_malgazzar', 'malgazzar_the_flameborn', 12, 0.33, 10);
await bossCam('a05_vekru', 'archlich_vekru', 11, 0.33, 9);
await bossCam('a06_xalthrea', 'broodmother_xalthrea', 12, 0.33, 10);
await bossCam('a07_devourer', 'xal_goreth_the_devourer', 18, 0.45, 14); // throne money shot

// --- live combat: aggro the Devourer, catch a telegraph / raid-warning banner ---
console.log('engaging the Devourer for a mechanics frame...');
await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player, o = window.__o;
  p.maxHp = 1e7; p.hp = 1e7;
  let boss = null;
  for (const e of sim.entities.values()) if (e.templateId === 'xal_goreth_the_devourer' && !e.dead) boss = e;
  if (boss) {
    p.pos.x = boss.pos.x; p.pos.z = boss.pos.z - 7; p.prevPos = { x: p.pos.x, z: p.pos.z };
    p.facing = 0; g.input.camYaw = 0; g.input.camPitch = 0.42; g.input.camDist = 17;
    sim.targetEntity && sim.targetEntity(boss.id);
    sim.startAutoAttack && sim.startAutoAttack();
  }
});
for (let i = 0; i < 9; i++) {
  await sleep(1800);
  await page.evaluate(() => { const p = window.__game.sim.player; p.maxHp = 1e7; p.hp = 1e7; });
  await page.screenshot({ path: `${OUT}/a08_fight_${i}.png` });
}
console.log('shot a08_fight_* (9 frames)');

if (errors.length) { console.log('\n--- page errors ---'); for (const e of errors.slice(0, 20)) console.log(e); }
await browser.close();
console.log('\ndone -> ' + OUT);
