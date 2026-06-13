/**
 * Record an animated sources-export demo and export docs/assets/demo.gif (+ demo.webm)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DEMO_HTML = path.join(ROOT, 'docs', 'assets', 'screenshots', 'sources-demo.html');
const ASSETS = path.join(ROOT, 'docs', 'assets');
const TMP = path.join(ROOT, 'tmp', 'demo-capture');
const VIEWPORT = { width: 800, height: 520 };
const FPS = 12;
const FRAMES = 120;
const FRAME_MS = 1000 / FPS;

async function captureFrames(page) {
  const framesDir = path.join(TMP, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((tick) => window.__demoTick(tick), i);
    await page.waitForTimeout(FRAME_MS);
    const framePath = path.join(framesDir, `frame-${String(i).padStart(4, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
  }
  return framesDir;
}

function exportFromFrames(framesDir, outFile, extraArgs) {
  const pattern = path.join(framesDir, 'frame-%04d.png').replace(/\\/g, '/');
  const outPath = outFile.replace(/\\/g, '/');
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${pattern}" ${extraArgs} "${outPath}"`,
    { stdio: 'inherit' }
  );
}

function framesToGif(framesDir, outGif) {
  const palette = path.join(TMP, 'palette.png');
  const pattern = path.join(framesDir, 'frame-%04d.png').replace(/\\/g, '/');
  const palettePath = palette.replace(/\\/g, '/');
  const outPath = outGif.replace(/\\/g, '/');

  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${pattern}" -vf "fps=${FPS},scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" "${palettePath}"`,
    { stdio: 'inherit' }
  );
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${pattern}" -i "${palettePath}" -lavfi "fps=${FPS},scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "${outPath}"`,
    { stdio: 'inherit' }
  );
}

async function main() {
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const url = `file:///${DEMO_HTML.replace(/\\/g, '/')}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const framesDir = await captureFrames(page);
  await browser.close();

  const gifPath = path.join(ASSETS, 'demo.gif');
  framesToGif(framesDir, gifPath);
  const stat = fs.statSync(gifPath);
  console.log('wrote', gifPath, `(${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

  const webmPath = path.join(ASSETS, 'demo.webm');
  exportFromFrames(
    framesDir,
    webmPath,
    '-c:v libvpx-vp9 -pix_fmt yuv420p -crf 32 -b:v 0 -an'
  );
  const webmStat = fs.statSync(webmPath);
  console.log('wrote', webmPath, `(${(webmStat.size / 1024 / 1024).toFixed(2)} MB)`);

  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});