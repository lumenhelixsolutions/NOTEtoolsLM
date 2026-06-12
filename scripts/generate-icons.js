/**
 * Renders docs/assets/logo-mark.svg into extension icon PNGs via Playwright.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'docs', 'assets', 'logo-mark.svg');
const OUT_DIR = path.join(ROOT, 'extension', 'icons');
const SIZES = [16, 32, 48, 128];

async function main() {
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:#0a0e17">
      <img src="${dataUrl}" width="${size}" height="${size}" />
    </body></html>`);
    const out = path.join(OUT_DIR, `icon${size}.png`);
    await page.locator('img').screenshot({ path: out, omitBackground: false });
    console.log('wrote', out);
  }

  // OG image 1200x630
  const ogPath = path.join(ROOT, 'docs', 'assets', 'og-image.png');
  const bannerSvg = fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'banner.svg'), 'utf8');
  const bannerUrl = `data:image/svg+xml;base64,${Buffer.from(bannerSvg).toString('base64')}`;
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:#0a0e17;display:flex;align-items:center;justify-content:center;height:630px">
    <img src="${bannerUrl}" style="width:1100px;border-radius:16px" />
  </body></html>`);
  await page.screenshot({ path: ogPath, fullPage: false });
  console.log('wrote', ogPath);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});