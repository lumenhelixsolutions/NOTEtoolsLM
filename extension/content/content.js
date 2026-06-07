// NOTEtoolsLM — Content Script
// Runs on notebooklm.google.com: scrapes artifacts, injects toolbar, injects prefabs

const TYPE_MAP = {
  audio: ['audio', 'podcast', 'deep-dive', 'deep dive', 'briefing', 'tutorial'],
  video: ['video', 'explainer', 'overview'],
  slide_deck: ['slide', 'deck', 'presentation', 'investor'],
  mind_map: ['mind map', 'mindmap', 'knowledge map'],
  report: ['report', 'briefing', 'study guide', 'faq']
};

let toolbarEl = null;
let observer = null;
let lastScrape = new Set();

// ─── Init ───
function init() {
  detectNotebook();
  scrapeArtifacts();
  injectToolbar();
  startObserver();

  // Listen for prefab inject requests from side panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'prefab:inject') {
      injectPrefab(msg.prefabId, msg.topic, msg.audience);
      sendResponse({ injected: true });
      return true;
    }
    if (msg.action === 'scan:request') {
      const arts = scrapeArtifacts();
      sendResponse({ scanned: true, count: arts.length });
      return true;
    }
  });
}

// ─── Detect active notebook ───
function detectNotebook() {
  const match = location.pathname.match(/\/notebook\/([^/]+)/);
  const notebookId = match ? match[1] : '';
  let notebookName = '';
  const h1 = document.querySelector('h1');
  if (h1) notebookName = h1.textContent.trim();
  // Also try nav/title
  if (!notebookName) notebookName = document.title.replace(' - NotebookLM', '').trim();

  if (notebookId) {
    chrome.runtime.sendMessage({
      action: 'notebook:detected',
      notebookId,
      notebookName
    }).catch(() => {});
  }
}

// ─── Scrape artifacts from DOM ───
function scrapeArtifacts() {
  const artifacts = [];
  const seen = new Set();

  // Try multiple selectors that NotebookLM uses for artifact cards
  const selectors = [
    '[data-testid*="artifact"]',
    '[data-testid*="studio"]',
    '[class*="artifact-card"]',
    '[class*="studio-card"]',
    '[class*="output-card"]',
    'div[class*="card"] audio',
    'div[class*="card"] video',
    '[role="article"]',
    'article'
  ];

  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach(el => {
      const card = el.closest('div[class*="card"]') || el.closest('article') || el;
      const titleEl = card.querySelector('h3, h4, h5, [class*="title"], [class*="name"]');
      const title = titleEl ? titleEl.textContent.trim() : '';

      // Deduplicate by title
      if (!title || seen.has(title)) return;
      seen.add(title);

      // Infer type
      const type = inferType(card, title, el.tagName);

      // Find download link
      let downloadUrl = '';
      const linkEl = card.querySelector('a[href*="download"], a[href*="audio"], a[href*="video"]');
      if (linkEl) downloadUrl = linkEl.href;

      // Try to get audio/video src directly
      if (!downloadUrl) {
        const media = card.querySelector('audio[src], video[src]');
        if (media) downloadUrl = media.src;
      }

      // Extract ID from URL or generate
      let id = '';
      const idMatch = downloadUrl.match(/[?&]id=([^&]+)/) || card.getAttribute('data-id');
      id = idMatch ? (typeof idMatch === 'string' ? idMatch : idMatch[1]) : hashId(title);

      artifacts.push({
        id: 'art_' + id,
        title,
        type,
        downloadUrl,
        pageUrl: location.href,
        notebookId: '',
        notebookName: '',
        status: 'cloud',
        discoveredAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });
    });
  }

  // Also look for raw media elements not in cards
  document.querySelectorAll('audio, video').forEach(el => {
    const src = el.src || el.querySelector('source')?.src;
    if (!src) return;
    const container = el.closest('div[class]') || el.parentElement;
    const title = container?.querySelector('h3,h4,h5')?.textContent?.trim() ||
                  container?.textContent?.substring(0, 50).trim() ||
                  'Media File';
    if (seen.has(title)) return;
    seen.add(title);

    artifacts.push({
      id: 'art_' + hashId(title + src),
      title,
      type: el.tagName.toLowerCase() === 'video' ? 'video' : 'audio',
      downloadUrl: src,
      pageUrl: location.href,
      notebookId: '',
      notebookName: '',
      status: 'cloud',
      discoveredAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });
  });

  if (artifacts.length > 0) {
    const notebookId = location.pathname.match(/\/notebook\/([^/]+)/)?.[1] || '';
    const notebookName = document.querySelector('h1')?.textContent?.trim() || '';
    chrome.runtime.sendMessage({
      action: 'artifacts:discovered',
      artifacts,
      notebookId,
      notebookName
    }).catch(() => {});
  }

  return artifacts;
}

// ─── Infer artifact type ───
function inferType(card, title, tagName) {
  const text = (title + ' ' + (card.textContent || '')).toLowerCase();
  if (tagName === 'VIDEO') return 'video';

  for (const [type, keywords] of Object.entries(TYPE_MAP)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return type;
    }
  }

  // Check for icon/type indicators in the card
  const typeEl = card.querySelector('[class*="type"], [class*="badge"], [class*="label"]');
  if (typeEl) {
    const t = typeEl.textContent.toLowerCase();
    if (t.includes('video')) return 'video';
    if (t.includes('slide') || t.includes('deck')) return 'slide_deck';
    if (t.includes('report') || t.includes('briefing')) return 'report';
    if (t.includes('map') || t.includes('mind')) return 'mind_map';
  }

  return 'audio'; // default
}

// ─── Hash string to ID ───
function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

// ─── MutationObserver for live detection ───
function startObserver() {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    let shouldScrape = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) { // Element
          const el = node;
          if (el.matches?.('audio, video, [class*="card"], [data-testid*="artifact"], article')) {
            shouldScrape = true;
          }
          if (el.querySelector?.('audio, video, [class*="card"], [data-testid*="artifact"]')) {
            shouldScrape = true;
          }
        }
      }
    }
    if (shouldScrape) {
      // Debounced scrape
      clearTimeout(window._plmScrapeTimer);
      window._plmScrapeTimer = setTimeout(() => scrapeArtifacts(), 800);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ─── Inject floating toolbar ───
function injectToolbar() {
  if (toolbarEl) return;
  if (document.getElementById('plm-toolbar')) return;

  const div = document.createElement('div');
  div.id = 'plm-toolbar';
  div.innerHTML = `
    <style>
      #plm-toolbar { position:fixed; top:72px; right:16px; z-index:2147483646; font-family:Inter,system-ui,sans-serif; font-size:12px; }
      #plm-toolbar * { box-sizing:border-box; }
      .plm-tb-collapsed { width:40px; height:40px; border-radius:20px; background:#0f172a; border:1px solid rgba(255,255,255,0.1); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 4px 24px rgba(0,0,0,0.4); transition:all .2s; }
      .plm-tb-collapsed:hover { transform:scale(1.1); border-color:#3b82f6; }
      .plm-tb-expanded { width:260px; background:#0f172a; border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:12px; box-shadow:0 8px 32px rgba(0,0,0,0.5); animation:plmFade .15s ease-out; }
      @keyframes plmFade { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
      .plm-tb-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
      .plm-tb-title { font-weight:600; font-size:13px; color:#e2e8f0; display:flex; align-items:center; gap:6px; }
      .plm-tb-close { width:22px; height:22px; border-radius:6px; background:rgba(255,255,255,0.05); border:none; color:#94a3b8; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; }
      .plm-tb-close:hover { background:rgba(255,255,255,0.1); color:#fff; }
      .plm-tb-input { width:100%; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:#1e293b; color:#e2e8f0; font-size:12px; margin-bottom:6px; outline:none; font-family:inherit; }
      .plm-tb-input:focus { border-color:#3b82f6; }
      .plm-tb-input::placeholder { color:#475569; }
      .plm-tb-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-top:8px; }
      .plm-tb-prefab { padding:8px 4px; border-radius:8px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.03); color:#94a3b8; cursor:pointer; text-align:center; font-size:11px; transition:all .15s; }
      .plm-tb-prefab:hover { background:#3b82f6; color:#fff; border-color:#3b82f6; }
      .plm-tb-prefab .emoji { font-size:18px; display:block; margin-bottom:3px; }
      .plm-tb-prefab .name { font-size:10px; }
    </style>
    <div class="plm-tb-collapsed" id="plm-tb-toggle" title="NOTEtoolsLM">&#9889;</div>
    <div class="plm-tb-expanded" id="plm-tb-body" style="display:none;">
      <div class="plm-tb-header">
        <span class="plm-tb-title">&#9889; Quick Launch</span>
        <button class="plm-tb-close" id="plm-tb-close">&times;</button>
      </div>
      <input class="plm-tb-input" id="plm-tb-topic" placeholder="Target Topic" />
      <input class="plm-tb-input" id="plm-tb-audience" placeholder="Target Audience" />
      <div class="plm-tb-grid" id="plm-tb-grid"></div>
    </div>
  `;

  document.body.appendChild(div);
  toolbarEl = div;

  // Render prefab buttons
  const PREFABS = [
    { id: 'deep-dive', name: 'Deep-Dive', icon: '\uD83C\uDF99' },
    { id: 'exec-brief', name: 'Brief', icon: '\uD83D\uDCCA' },
    { id: 'explainer', name: 'Video', icon: '\uD83C\uDFAC' },
    { id: 'investor-deck', name: 'Slides', icon: '\uD83D\uDCC1' },
    { id: 'mind-map', name: 'Map', icon: '\uD83E\uDDE0' },
    { id: 'tutorial', name: 'Tutorial', icon: '\uD83C\uDF93' }
  ];

  const grid = div.querySelector('#plm-tb-grid');
  grid.innerHTML = PREFABS.map(p => `
    <div class="plm-tb-prefab" data-id="${p.id}">
      <span class="emoji">${p.icon}</span>
      <span class="name">${p.name}</span>
    </div>
  `).join('');

  // Event handlers
  div.querySelector('#plm-tb-toggle').addEventListener('click', () => {
    div.querySelector('#plm-tb-toggle').style.display = 'none';
    div.querySelector('#plm-tb-body').style.display = 'block';
  });
  div.querySelector('#plm-tb-close').addEventListener('click', () => {
    div.querySelector('#plm-tb-body').style.display = 'none';
    div.querySelector('#plm-tb-toggle').style.display = 'flex';
  });
  grid.querySelectorAll('.plm-tb-prefab').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = div.querySelector('#plm-tb-topic').value.trim();
      const audience = div.querySelector('#plm-tb-audience').value.trim();
      const prefabId = btn.dataset.id;
      if (!topic) { div.querySelector('#plm-tb-topic').focus(); return; }
      if (!audience) { div.querySelector('#plm-tb-audience').focus(); return; }
      injectPrefab(prefabId, topic, audience);
    });
  });

  // Make draggable
  makeDraggable(div.querySelector('#plm-tb-toggle'));
}

// ─── Make element draggable ───
function makeDraggable(el) {
  let dragging = false, startX, startY, startLeft, startTop;
  const container = el.parentElement;
  el.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(container.style.right) || 16;
    startTop = parseInt(container.style.top) || 72;
    el.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = startX - e.clientX;
    const dy = e.clientY - startY;
    container.style.right = (startLeft + dx) + 'px';
    container.style.top = (startTop + dy) + 'px';
    container.style.left = 'auto';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    el.style.cursor = 'pointer';
  });
}

// ─── Inject prefab into NotebookLM ───
function injectPrefab(prefabId, topic, audience) {
  const PREFAB_TEMPLATES = {
    'deep-dive': 'Create a deep-dive podcast episode about {topic} for {audience}. Use a conversational format with two hosts exploring the subject in depth, citing sources naturally. Target 15-20 minutes. Include an intro hook, segment transitions, and a closing summary with key takeaways.',
    'exec-brief': 'Generate an executive briefing about {topic} tailored for {audience}. Structure: Executive Summary (3 bullets), Key Findings, Strategic Implications, Recommended Actions, and Risk Assessment. Keep it concise and professional.',
    'explainer': 'Write an explainer video script about {topic} for {audience}. Include scene descriptions, on-screen text suggestions, narrator voiceover, and timing cues. Structure: Hook (0-5s), Problem (5-20s), Solution (20-50s), How It Works (50-80s), CTA (80-90s).',
    'investor-deck': 'Create an investor slide deck outline about {topic} targeting {audience}. Include: Title Slide, Problem Statement, Market Opportunity, Solution Overview, Business Model, Traction, Team, Financials, and Ask. Provide speaker notes for each slide.',
    'mind-map': 'Generate a hierarchical mind map about {topic} designed for {audience}. Start with a central concept, branch into 5-7 main categories, each with 3-5 sub-branches. Include connection descriptions and brief explanatory notes for each node.',
    'tutorial': 'Create a step-by-step tutorial about {topic} aimed at {audience}. Break into 5-8 clear steps. Use encouraging, instructional tone. Include prerequisites, time estimates per step, common pitfalls, and a recap.'
  };

  const template = PREFAB_TEMPLATES[prefabId];
  if (!template) return;

  let prompt = template.replace(/{topic}/g, topic).replace(/{audience}/g, audience);
  if (prompt.length > 10000) prompt = prompt.slice(0, 10000);

  // Find and fill the instructions textarea
  const textarea = document.querySelector('textarea[placeholder*="instructions"], textarea[placeholder*="prompt"], textarea[class*="instructions"], textarea[class*="custom"]');
  if (textarea) {
    textarea.value = prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    // Find and click generate
    setTimeout(() => {
      const genBtn = document.querySelector('button[class*="generate"], button[data-testid*="generate"], button:has-text("Generate")');
      if (genBtn) genBtn.click();
    }, 200);

    showToolbarToast('Prefab injected! Generating...');
  } else {
    // Fallback: copy to clipboard + show toast
    navigator.clipboard.writeText(prompt).then(() => {
      showToolbarToast('Prompt copied! Paste into NotebookLM');
    });
  }
}

// ─── Toast on toolbar ───
function showToolbarToast(msg) {
  const existing = document.getElementById('plm-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'plm-toast';
  toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0f172a;color:#e2e8f0;padding:10px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);font-size:12px;font-family:Inter,system-ui;box-shadow:0 4px 24px rgba(0,0,0,0.4);animation:plmFade .2s ease-out;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Run ───
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
