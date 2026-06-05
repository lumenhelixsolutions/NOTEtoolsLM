// PipelineLM Pro — Onboarding Controller

const TOTAL = 5;
let current = 0;

const slidesEl = document.getElementById('slides');
const progressEl = document.getElementById('progress');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const dotsEl = document.getElementById('dots');

// Create dots
for (let i = 0; i < TOTAL; i++) {
  const dot = document.createElement('div');
  dot.className = 'dot' + (i === 0 ? ' active' : '');
  dot.addEventListener('click', () => goTo(i));
  dotsEl.appendChild(dot);
}

function goTo(index) {
  current = Math.max(0, Math.min(TOTAL - 1, index));

  // Show current slide, hide others
  document.querySelectorAll('.slide').forEach((slide, i) => {
    slide.style.display = i === current ? 'flex' : 'none';
  });

  progressEl.style.width = ((current + 1) / TOTAL * 100) + '%';

  btnPrev.disabled = current === 0;

  if (current === TOTAL - 1) {
    btnNext.style.display = 'none';
  } else {
    btnNext.style.display = '';
    btnNext.textContent = 'Next';
  }

  dotsEl.querySelectorAll('.dot').forEach((d, i) => {
    d.classList.toggle('active', i === current);
  });
}

// Event listeners
btnPrev.addEventListener('click', () => goTo(current - 1));
btnNext.addEventListener('click', () => goTo(current + 1));

document.getElementById('btn-start').addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({ 'plm:onboarded': true });
  } catch (e) {}
  window.location.href = 'sidepanel.html';
});

document.getElementById('btn-activate').addEventListener('click', async () => {
  const key = document.getElementById('license-input').value.trim();
  if (!key) {
    goTo(4);
    return;
  }
  if (!key.startsWith('PLM-')) {
    alert('License key should start with PLM-');
    return;
  }
  try {
    const data = await chrome.storage.local.get('plm:settings');
    const s = data['plm:settings'] || {};
    s.licenseKey = key;
    await chrome.storage.local.set({ 'plm:settings': s });
  } catch (e) {}
  goTo(4);
});

// Handle Enter on license input
document.getElementById('license-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-activate').click();
});

// Init
goTo(0);
