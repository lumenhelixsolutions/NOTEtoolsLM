/**
 * Capture GitHub Pages launch site screenshots for docs/assets/screenshots/
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'screenshots');

const PAGES = [
  { file: 'index.html', name: '01-launch-hero', viewport: { width: 1280, height: 900 } },
  { file: 'index.html', name: '02-features', viewport: { width: 1280, height: 900 }, scrollY: 520 },
  { file: 'install.html', name: '03-install-guide', viewport: { width: 1280, height: 900 } },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const spec of PAGES) {
    const url = `file:///${path.join(ROOT, 'docs', spec.file).replace(/\\/g, '/')}`;
    await page.setViewportSize(spec.viewport);
    await page.goto(url, { waitUntil: 'networkidle' });
    if (spec.scrollY) await page.evaluate((y) => window.scrollTo(0, y), spec.scrollY);
    await page.waitForTimeout(400);
    const outPath = path.join(OUT, `${spec.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log('wrote', outPath);
  }

  const demoUrl = `file:///${path.join(ROOT, 'docs', 'assets', 'screenshots', 'sources-demo.html').replace(/\\/g, '/')}`;
  await page.setViewportSize({ width: 800, height: 520 });
  await page.goto(demoUrl, { waitUntil: 'networkidle' });
  await page.evaluate((tick) => window.__demoTick(tick), 55);
  await page.waitForTimeout(300);
  const sourcesPath = path.join(OUT, '04-sources-export.png');
  await page.screenshot({ path: sourcesPath, fullPage: false });
  console.log('wrote', sourcesPath);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});