// Drives the offline client into the new Labyrinth arena with an optional gold
// wager, and captures screenshots to tmp/. No server/DB needed: it adds a rival
// straight into the offline Sim, queues both, and rides the bout through the
// wager window, the maze fight, and the ranked + gold result.
//
//   npm run dev          # (separate shell) serves the client on :5173
//   node scripts/labyrinth_wager_visual.mjs
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

chromium.setGraphicsMode = true; // keep swiftshader WebGL on for Three.js
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
  args: [...chromium.args, '--enable-unsafe-swiftshader', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

// move the player to an instance-local spot in their arena pit + aim the camera.
// Uses the pit origin captured once at seat time (window.__ORIGIN) so repeated
// calls don't compound the offset.
async function frame(localX, localZ, camDist, camPitch) {
  await page.evaluate((lx, lz, cd, cp) => {
    const sim = window.__game.sim;
    const me = sim.player;
    const o = window.__ORIGIN;
    me.pos.x = o.x + lx; me.pos.z = o.z + lz; me.pos.y = 0;
    me.prevPos = { x: me.pos.x, y: me.pos.y, z: me.pos.z };
    sim.rebucket(me);
    window.__game.input.camDist = cd; window.__game.input.camPitch = cp;
  }, localX, localZ, camDist, camPitch);
}

console.log('booting offline as a mage…');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(600);
await page.click('#btn-offline');
await sleep(250);
await page.type('#char-name', 'Mageling');
await page.click('#offline-select .mini-class[data-class="mage"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.entities?.size > 0, { timeout: 20000, polling: 300 });
await sleep(1800);

// 0. The arena panel before queueing: ranked blurb now mentions both maps + the
//    optional wager.
await page.evaluate(() => window.__game.hud.toggleArena());
await sleep(700);
await page.screenshot({ path: 'tmp/lab0_panel.png' });
await page.evaluate(() => window.__game.hud.toggleArena());

// Fund the duellist, drop a rival into the offline Sim, fund them too, queue
// both. The first bout on a fresh world always draws the Labyrinth.
const rival = await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.copper = 500000; // 50g to wager with
  const rid = sim.addPlayer('warrior', 'Bruiser');
  sim.meta(rid).copper = 500000;
  return rid;
});
// Queue the rival first so the viewer is match.b: offline, the single HUD sees
// both fighters' personal events (online routes them per-client), and the last
// arenaEnd emitted wins the banner — we want the mage's victory to land.
await page.evaluate((rid) => {
  window.__game.sim.arenaQueueJoin(rid);
  window.__game.world.arenaQueueJoin();
}, rival);
await page.waitForFunction(() => window.__game.world.arenaInfo?.match != null, { timeout: 15000, polling: 200 });
// capture the pit origin once (player is at spawn A, local 0,-14)
await page.evaluate(() => { const p = window.__game.sim.player; window.__ORIGIN = { x: p.pos.x, z: p.pos.z + 14 }; });
const map = await page.evaluate(() => window.__game.world.arenaInfo.match.map);
console.log('seated on map:', map, map === 'labyrinth' ? 'OK' : '(expected labyrinth)');
await sleep(2600); // let the interior build

// 1. Both pledge a stake — the wager overlay shows tiers + the live pot, framed
//    over the maze corridors.
await page.evaluate((rid) => {
  window.__game.world.arenaPlaceWager(10000); // 1g
  window.__game.sim.arenaPlaceWager(10000, rid); // rival matches 1g
}, rival);
await frame(2, -9, 14, 0.42); // south of the spine, looking up the maze
await sleep(700);
await page.screenshot({ path: 'tmp/lab1_wager.png' });
const pot = await page.evaluate(() => window.__game.world.arenaInfo.match.pot);
console.log('live pot:', pot, pot === 20000 ? 'OK (2g)' : '');

// 2. A near-vertical read of the whole maze: spine, flank walls, pillar rings.
await frame(0, -1, 33, 1.4);
await sleep(900);
await page.screenshot({ path: 'tmp/lab2_maze_topdown.png' });

// 3. Ride out the wager window so the stake locks; the in-match banner shows the
//    map name + the escrowed pot during the countdown.
await page.waitForFunction(() => window.__game.world.arenaInfo?.match?.stakeLocked === true, { timeout: 16000, polling: 200 });
await frame(-6, -2, 13, 0.4); // tucked beside the spine + a pillar
await sleep(700);
await page.screenshot({ path: 'tmp/lab3_pot_locked.png' });

// 4. The live bout in the maze: pull the rival in beside the mage so the duel
//    frames against the pillars.
await page.waitForFunction(() => window.__game.world.arenaInfo?.match?.state === 'active', { timeout: 12000, polling: 200 });
await frame(4, -6, 12, 0.34);
await page.evaluate((rid) => {
  const sim = window.__game.sim;
  const me = sim.player;
  const r = sim.entities.get(rid);
  r.pos.x = me.pos.x + 3; r.pos.z = me.pos.z + 1.5; sim.rebucket(r);
  window.__game.world.targetEntity(rid);
  window.__game.world.startAutoAttack();
}, rival);
await sleep(1400);
await page.screenshot({ path: 'tmp/lab4_fight.png' });

// 5. Decide it for the mage so the wager pays out, then catch the result banner
//    (victory + rating + the gold won).
await page.evaluate((rid) => {
  const sim = window.__game.sim;
  sim.dealDamage(sim.player, sim.entities.get(rid), 99999, false, 'physical', null, 'hit');
}, rival);
await sleep(400);
await page.screenshot({ path: 'tmp/lab5_result.png' });
const after = await page.evaluate(() => {
  const a = window.__game.world.arenaInfo;
  return { gold: window.__game.world.copper, goldWon: a.goldWon, rating: a.rating, wins: a.wins };
});
console.log('post-bout:', JSON.stringify(after));

// 6. Reopen the panel: rating moved and lifetime wager winnings now show.
await sleep(1200);
await page.evaluate(() => window.__game.hud.toggleArena());
await sleep(900);
await page.screenshot({ path: 'tmp/lab6_panel_after.png' });

console.log(errors.length ? `(${errors.length} page errors, offline homepage fetches — ignored)` : 'no page errors');
await browser.close();
console.log('done — screenshots in tmp/');
