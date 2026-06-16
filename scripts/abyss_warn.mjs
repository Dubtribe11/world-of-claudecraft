// Capture ONE crisp frame of the raid-warning banner + void-zone telegraph as
// they naturally fire on the Devourer: snap fast, keep only full-opacity banner frames.
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
  let boss = null; for (const e of sim.entities.values()) if (e.templateId === 'xal_goreth_the_devourer') boss = e;
  window.__boss = boss.id;
  p.pos.x = boss.pos.x + 3; p.pos.z = boss.pos.z; p.prevPos = { x: p.pos.x, z: p.pos.z };
  p.facing = Math.atan2(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
  g.input.camYaw = p.facing; g.input.camPitch = 0.5; g.input.camDist = 15;
  sim.targetEntity(boss.id); sim.startAutoAttack && sim.startAutoAttack();
  boss.targetId = p.id; boss.inCombat = true;
});
await sleep(4000); // interior build

let got = 0;
for (let i = 0; i < 120 && got < 3; i++) {
  const op = await page.evaluate((i) => {
    const g = window.__game, sim = g.sim, p = sim.player; p.maxHp = 1e7; p.hp = 1e7;
    const boss = sim.entities.get(window.__boss);
    if (boss) { boss.inCombat = true; if (boss.targetId == null) boss.targetId = p.id; if (i % 10 === 0) boss.voidTimer = 0.3; }
    const b = document.getElementById('banner');
    return b ? parseFloat(getComputedStyle(b).opacity) * ((b.textContent || '').trim() && (b.textContent || '').trim() !== 'Eastbrook Vale' ? 1 : 0) : 0;
  }, i);
  if (op > 0.85) { await page.screenshot({ path: `${OUT}/warn_${got}.png` }); got++; console.log('crisp banner frame', got); }
  await sleep(120);
}
console.log('captured', got, 'crisp banner frames');
await browser.close();
