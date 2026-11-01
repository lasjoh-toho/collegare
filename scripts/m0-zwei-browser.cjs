// M0-Spike: zwei bzw. drei Browser bearbeiten dasselbe Dokument über den Collegare-Server.
// Server mit SPIKE=1 starten (Test-Endpunkte unter /api/spike).
// Voraussetzung: Server (server/: pnpm dev) auf :8787 und Next (web/: pnpm dev) auf :3000.
// Aufruf: node scripts/m0-zwei-browser.cjs [docx|pptx]
const { chromium } = require('playwright');
const kind = process.argv[2] || 'docx';
const doc = 'm0-' + Date.now();
const api = (p, body) =>
  fetch('http://localhost:8787/api/spike/docs/' + doc + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined).then((r) => r.json());

(async () => {
  const b = await chromium.launch();
  const open = async (name) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:3000/editor?new=${kind}&collab=${doc}&name=${name}`);
    return p;
  };
  const anna = await open('Anna');
  await anna.waitForTimeout(8000);
  const ben = await open('Ben');
  await ben.waitForTimeout(10000);

  await anna.mouse.click(kind === 'pptx' ? 700 : 640, kind === 'pptx' ? 330 : 400);
  await anna.keyboard.type(kind === 'pptx' ? 'Folie von Anna' : 'Absatz von Anna.', { delay: 25 });
  await anna.waitForTimeout(3000);
  await ben.screenshot({ path: `m0-${kind}-ben-sieht-anna.png` });
  console.log('Nach Anna:', JSON.stringify((await api('')).changesByUser));

  if (kind === 'docx') {
    // Absatz-ID des ersten Absatzes in einem neuen Dokument (OnlyOffice 9.3.1, im strengen Modus beobachtet).
    // Ab M1 liest der Fertig-Knopf die ID im Editor aus.
    console.log('Fertig:', JSON.stringify(await api('/finish', { user: 'anna', keys: ['668'] })));
    await anna.waitForTimeout(1500);
    await ben.mouse.click(640, 300);
    await ben.keyboard.press('End');
    await ben.keyboard.type(' Ben schreibt hinein', { delay: 25 });
    await ben.waitForTimeout(2500);
    await ben.screenshot({ path: 'm0-docx-ben-gesperrt.png' });
    console.log('Nach Bens Versuch:', JSON.stringify((await api('')).changesByUser));
  }

  const clara = await open('Clara');
  await clara.waitForTimeout(12000);
  await clara.screenshot({ path: `m0-${kind}-clara-spaeter.png` });
  await b.close();
})();
