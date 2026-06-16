// Focused capture: engage the Devourer and snap rapidly to catch a raid-warning
// banner ("tooltip in the fight") + a void-zone telegraph ring on the ground.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173/?gfx=high';
const OUT = 'tmp/abyss';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
await page.click('#btn-offline'); await sleep(300);
await page.type('#char-name', 'Ashveil');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline'); await sleep(3500);

await page.evaluate(() => {
  const g = window.__game, sim = g.sim, p = sim.player;
  p.level = 20; p.maxHp = 1e7; p.hp = 1e7;
  const inst = sim.instances.find((i) => i.dungeonId === 'abyssal_maw' && i.partyKey === null);
  sim.claimInstance(inst, 'solo:' + p.id);
  const o = sim.instanceOriginOf(inst); window.__o = o;
  let boss = null; for (const e of sim.entities.values()) if (e.templateId === 'xal_goreth_the_devourer') boss = e;
  window.__boss = boss.id;
  p.pos.x = boss.pos.x + 3; p.pos.z = boss.pos.z; p.prevPos = { x: p.pos.x, z: p.pos.z }; // melee range
  p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
  g.input.camYaw = p.facing; g.input.camPitch = 0.42; g.input.camDist = 16;
  sim.targetEntity(boss.id); sim.startAutoAttack && sim.startAutoAttack();
  // force the boss into active combat so its attack-state mechanics tick
  boss.targetId = p.id; boss.inCombat = true;
});
await sleep(4000); // interior build

// snap every 350ms for ~24s; prime the void timer so a telegraph + raid-warning
// banner fire on cue, and grab every frame where the center banner is up.
let banners = 0;
for (let i = 0; i < 70; i++) {
  const visible = await page.evaluate((i) => {
    const g = window.__game, sim = g.sim, p = sim.player; p.maxHp = 1e7; p.hp = 1e7;
    const boss = sim.entities.get(window.__boss);
    if (boss) { boss.inCombat = true; if (boss.targetId == null) boss.targetId = p.id; if (i % 16 === 6) boss.voidTimer = 0.4; } // cue a void zone periodically
    const b = document.getElementById('banner');
    const txt = b ? (b.textContent || '').trim() : '';
    const shown = b && getComputedStyle(b).opacity !== '0' && txt.length > 0;
    return shown ? txt : '';
  }, i);
  if (visible && visible !== 'Eastbrook Vale') { banners++; await page.screenshot({ path: `${OUT}/banner_${String(i).padStart(2, '0')}.png` }); console.log('BANNER:', JSON.stringify(visible)); }
  await sleep(350);
}
console.log(`captured ${banners} banner frames`);
await browser.close();
