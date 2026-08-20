import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--no-sandbox'] });
for (const app of ['PpgDex','GlucoDex','CPAPDex','ECGDex','OxyDex']) {
  const p = await b.newPage();
  await p.goto(`http://127.0.0.1:8097/${app}.html`, { waitUntil:'load' });
  const r = await p.evaluate(() => ({ dc: typeof DexClock, allan: (typeof DexClock!=='undefined' && DexClock) ? typeof DexClock.allanFromPhase : 'n/a' }));
  console.log(`  ${app.padEnd(9)} typeof DexClock = ${r.dc.padEnd(9)} allanFromPhase = ${r.allan}`);
  await p.close();
}
await b.close();
