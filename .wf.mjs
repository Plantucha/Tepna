import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8097/Dex-Test-Suite.html?full', { waitUntil:'domcontentloaded' });
await p.waitForFunction(() => window.__rcState === 'done', null, { timeout: 900000, polling: 500 });
const out = await p.evaluate(() => {
  const res = [];
  document.querySelectorAll('.mk').forEach(m => {
    if ((m.textContent||'').includes('✕')) {
      const row = m.parentElement;
      let grp = row, name = '';
      for (let i=0;i<6 && grp;i++){ grp = grp.parentElement;
        if (grp && grp.previousElementSibling) { name = (grp.previousElementSibling.innerText||'').trim().slice(0,200); if(name) break; } }
      res.push({ assertion: (row.innerText||'').trim().slice(0,500), group: name });
    }
  });
  return res;
});
console.log(JSON.stringify(out, null, 2));
await b.close();
