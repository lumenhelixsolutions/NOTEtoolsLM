// NOTEtoolsLM — NotebookLM source DOM scraper
// Reimplements behavior inspired by NotebookLM Sources Exporter (local-only extraction).

(function initSourcesScraper(global) {
  if (global.__plmSourcesScraper) return;
  global.__plmSourcesScraper = true;

  let extractionCancelled = false;
  let extractionActive = false;

  function waitForElement(selector, timeout = 5000, root = document) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = root.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error(`Timeout waiting for element: ${selector}`));
        }
      }, 100);
    });
  }

  function findSourceScrollArea() {
    const picker = document.querySelector('source-picker');
    if (picker) {
      return picker.querySelector('div.scroll-area-desktop')
        || picker.querySelector('div.contents');
    }
    return document.querySelector('div.scroll-area-desktop')
      || document.querySelector('source-picker div.contents');
  }

  function processTextContent(el) {
    let text = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        const inner = node.textContent.trim();
        if (tag === 'i') text += `*${inner}*`;
        else if (tag === 'b' || tag === 'strong') text += `**${inner}**`;
        else text += processTextContent(node);
      }
    });
    return text.trim();
  }

  function processTable(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const lines = [];
    rows.forEach((row, idx) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => {
        const nested = cell.querySelector('labs-tailwind-structural-element-view-v2');
        if (nested) {
          const para = nested.querySelector('div[class*="paragraph"]');
          if (para) return processTextContent(para).trim();
        }
        return cell.textContent.trim();
      });
      lines.push(`| ${cells.join(' | ')} |`);
      if (idx === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
    });
    return `\n${lines.join('\n')}\n`;
  }

  function extractSourcesMetadata() {
    const scrollArea = findSourceScrollArea();
    if (!scrollArea) throw new Error('Could not find source list scroll area');

    const containers = Array.from(scrollArea.querySelectorAll('div.single-source-container'));
    const sources = [];

    containers.forEach((container, idx) => {
      let name = null;
      const titleCol = container.querySelector('div.source-title-column');
      if (titleCol) {
        const labeled = titleCol.querySelector('div.source-title[aria-label]');
        if (labeled) name = labeled.getAttribute('aria-label');
        else {
          const span = titleCol.querySelector('span');
          if (span) name = span.textContent.trim();
        }
      }
      if (!name) {
        const moreBtn = container.querySelector('button.source-item-more-button');
        if (moreBtn) name = moreBtn.getAttribute('aria-description');
      }
      if (!name) return;

      let type = null;
      const icon = container.querySelector('mat-icon.source-item-source-icon[role="img"]');
      if (icon) type = icon.textContent.trim() || icon.getAttribute('fontIcon');
      if (!type && container.querySelector('img.source-item-source-icon.favicon-icon')) type = 'web';
      if (!type) type = 'unknown';

      const checkbox = container.querySelector(
        '.select-checkbox-container mat-checkbox.mat-mdc-checkbox.select-checkbox .mdc-checkbox input[type="checkbox"].mdc-checkbox__native-control'
      );
      const checkboxFound = !!checkbox;
      const isSelected = !checkboxFound || checkbox.checked;

      sources.push({
        index: idx + 1,
        name,
        type,
        checkboxFound,
        isSelected,
        container,
      });
    });

    return sources;
  }

  async function clickSource(container) {
    const btn = container.querySelector('button.source-stretched-button')
      || container.querySelector('button[type="button"][aria-label]:not([aria-label="More"])');
    if (!btn) throw new Error('Could not find source open button');
    btn.click();
    await waitForElement('div.scroll-area', 5000);
    return true;
  }

  async function extractSourceContent(type) {
    let viewer = null;
    const panel = document.querySelector('section.source-panel');
    if (panel) {
      viewer = panel.querySelector('div.panel-content.source-panel-view-content source-viewer')
        || panel.querySelector('div.source-panel-view-content source-viewer')
        || panel.querySelector('div.panel-content source-viewer')
        || panel.querySelector('source-viewer');
    }
    if (!viewer) {
      const tabBody = document.querySelector('mat-tab-body[role="tabpanel"]');
      if (tabBody) viewer = tabBody.querySelector('source-viewer');
    }
    if (!viewer) viewer = document.querySelector('source-viewer');
    if (!viewer) throw new Error('Could not find source-viewer');

    const scrollContainer = viewer.querySelector('div.scroll-container');
    const scrollArea = scrollContainer?.querySelector('div.scroll-area');
    const elementsContainer = scrollArea?.querySelector('div.elements-container');
    const result = { content: '', videoUrl: null };

    if (type === 'video_youtube') {
      const yt = scrollArea?.querySelector('div.youtube-container')
        || viewer.querySelector('div.youtube-container');
      if (yt) {
        const iframe = yt.querySelector('iframe');
        const src = iframe?.getAttribute('src');
        const match = src?.match(/\/embed\/([^?]+)/);
        if (match?.[1]) result.videoUrl = `https://www.youtube.com/watch?v=${match[1]}`;
      }
    }

    const docViewer = elementsContainer?.querySelector('labs-tailwind-doc-viewer')
      || viewer.querySelector('labs-tailwind-doc-viewer');
    if (!docViewer) throw new Error('Could not find labs-tailwind-doc-viewer');

    const elements = Array.from(docViewer.querySelectorAll('labs-tailwind-structural-element-view-v2'));
    const chunks = [];

    elements.forEach((el) => {
      const imageView = el.querySelector('image-element-view');
      if (imageView) {
        const img = imageView.querySelector('img');
        if (img?.src) {
          chunks.push(`\n![image](${img.src})\n`);
          if (!result.imageUrl) {
            result.imageUrl = img.src;
            result.isImageSource = true;
          }
        }
        return;
      }

      const table = el.querySelector('table');
      if (table) {
        chunks.push(processTable(table));
        return;
      }

      Array.from(el.querySelectorAll('div[class*="paragraph"]')).forEach((para) => {
        const cls = para.className;
        const inlineImg = para.querySelector('img');
        if (inlineImg?.getAttribute('src')) {
          chunks.push(`\n![image](${inlineImg.getAttribute('src')})\n`);
          return;
        }

        const text = processTextContent(para);
        if (!text) return;
        if (text.includes('---') && text.length < 100 && /^-+$/m.test(text)) {
          chunks.push('\n---\n');
          return;
        }

        let prefix = '';
        if (text.charAt(0) === '•') {
          chunks.push(`\n- ${text.substring(1).trim()}`);
          return;
        }
        if (/^\d+\.\s/.test(text)) {
          chunks.push(`\n${text}`);
          return;
        }
        if (cls.includes('title')) prefix = '\n# ';
        else if (cls.includes('heading2')) prefix = '\n## ';
        else if (cls.includes('heading3')) prefix = '\n### ';
        else if (cls.includes('normal')) prefix = '\n';
        chunks.push(prefix + text);
      });
    });

    result.content = chunks.join('');
    return result;
  }

  async function goBackToSourcesList() {
    const panel = document.querySelector('section.source-panel');
    const header = panel?.querySelector('div.panel-header');

    if (header) {
      const clickable = header.querySelector('h2.panel-header-content span.panel-header-clickable');
      if (clickable) {
        clickable.click();
        await waitForElement('div.scroll-area-desktop', 3000).catch(() => waitForElement('source-picker', 2000));
        return true;
      }
      const collapseBtn = header.querySelector('button[mat-icon-button]');
      const collapseIcon = collapseBtn?.querySelector('mat-icon[role="img"]');
      if (collapseIcon?.textContent.trim() === 'collapse_content') {
        collapseBtn.click();
        await waitForElement('div.scroll-area-desktop', 3000).catch(() => waitForElement('source-picker', 2000));
        return true;
      }
      const closeBtn = header.querySelector('button[mattooltip="Close source view"]');
      if (closeBtn) {
        closeBtn.click();
        await waitForElement('div.scroll-area-desktop', 3000).catch(() => waitForElement('source-picker', 2000));
        return true;
      }
    }

    const tabBody = document.querySelector('mat-tab-body[role="tabpanel"]');
    const viewers = [
      tabBody?.querySelector('source-viewer'),
      tabBody,
      panel?.querySelector('source-viewer'),
      panel,
    ].filter(Boolean);

    for (const viewer of viewers) {
      for (const icon of viewer.querySelectorAll('mat-icon[role="img"]')) {
        if (icon.textContent.trim() !== 'arrow_back') continue;
        let parent = icon.parentElement;
        while (parent && parent !== viewer) {
          if (parent.tagName === 'BUTTON') {
            parent.click();
            await waitForElement('div.scroll-area-desktop', 3000).catch(() => waitForElement('source-picker', 2000));
            return true;
          }
          parent = parent.parentElement;
        }
      }
    }

    throw new Error('Could not find a way to go back to sources list');
  }

  async function ensureAtSourcesList() {
    if (document.querySelector('source-viewer')) {
      await goBackToSourcesList();
    } else if (!document.querySelector('source-picker')) {
      try {
        await goBackToSourcesList();
      } catch (_) { /* already at list */ }
    }
  }

  function getSourceContainers() {
    const scrollArea = findSourceScrollArea();
    if (!scrollArea) throw new Error('Could not find source list scroll area');
    return Array.from(scrollArea.querySelectorAll('div.single-source-container'));
  }

  function createOverlay() {
    let overlay = document.getElementById('plm-sources-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'plm-sources-overlay';
    overlay.innerHTML = `
      <style>
        #plm-sources-overlay { position:fixed; inset:0; z-index:2147483645; background:rgba(0,0,0,0.55);
          display:flex; align-items:center; justify-content:center; font-family:Inter,system-ui,sans-serif; }
        #plm-sources-overlay .box { background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:12px;
          padding:24px 28px; width:min(420px,90vw); color:#e2e8f0; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
        #plm-sources-overlay h2 { font-size:16px; margin:0 0 16px; }
        #plm-sources-overlay .bar { height:6px; background:#1e293b; border-radius:3px; overflow:hidden; margin-bottom:10px; }
        #plm-sources-overlay .fill { height:100%; width:0%; background:#3b82f6; transition:width .2s; }
        #plm-sources-overlay .status { font-size:12px; color:#94a3b8; min-height:18px; }
        #plm-sources-overlay .cancel { margin-top:16px; padding:8px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);
          background:transparent; color:#94a3b8; cursor:pointer; font-size:12px; }
        #plm-sources-overlay .cancel:hover { color:#fff; border-color:#ef4444; }
      </style>
      <div class="box">
        <h2>Extracting NotebookLM Sources</h2>
        <div class="bar"><div class="fill" id="plm-sources-progress"></div></div>
        <div class="status" id="plm-sources-status">Initializing...</div>
        <button class="cancel" id="plm-sources-cancel">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#plm-sources-cancel').addEventListener('click', () => {
      extractionCancelled = true;
      removeOverlay();
    });
    return overlay;
  }

  function updateOverlay(current, total, message) {
    const fill = document.getElementById('plm-sources-progress');
    const status = document.getElementById('plm-sources-status');
    if (fill) fill.style.width = total ? `${Math.round((current / total) * 100)}%` : '0%';
    if (status) status.textContent = message || '';
  }

  function removeOverlay() {
    document.getElementById('plm-sources-overlay')?.remove();
  }

  async function extractAllSources(onProgress) {
    const metadata = extractSourcesMetadata();
    if (!metadata.length) return { sources: [], excludedCount: 0 };

    const hasSelection = metadata.some((s) => s.checkboxFound && s.isSelected);
    const sources = hasSelection
      ? metadata.map((s) => {
          if (s.checkboxFound && !s.isSelected) {
            const { container, checkboxFound, isSelected, ...rest } = s;
            return { ...rest, excluded: true, content: null };
          }
          return s;
        })
      : metadata;

    const excludedCount = sources.filter((s) => s.excluded).length;
    const active = sources.filter((s) => !s.excluded);
    onProgress(0, active.length, `Found ${active.length} sources${excludedCount ? ` (${excludedCount} excluded)` : ''}`);

    const maxEarlyFailures = 3;
    let consecutiveFailures = 0;
    let firstError = null;
    let extracted = 0;

    for (let i = 0; i < sources.length; i++) {
      if (extractionCancelled) return { sources: [], excludedCount: 0 };

      const source = sources[i];
      if (source.excluded) continue;

      onProgress(extracted, active.length, `Extracting ${extracted + 1}/${active.length}: ${source.name}`);

      try {
        const containers = getSourceContainers();
        const idx = source.index - 1;
        if (idx >= containers.length) {
          throw new Error(`Source index ${idx} out of bounds (only ${containers.length} containers found)`);
        }
        await clickSource(containers[idx]);
        const content = await extractSourceContent(source.type);
        source.content = content.content;
        source.contentLength = content.content.length;
        if (content.imageUrl) {
          source.imageUrl = content.imageUrl;
          source.isImageSource = content.isImageSource || false;
        }
        if (content.videoUrl) source.videoUrl = content.videoUrl;
        delete source.container;
        delete source.checkboxFound;
        delete source.isSelected;
        extracted++;
        consecutiveFailures = 0;
        firstError = null;
        await goBackToSourcesList();
      } catch (err) {
        consecutiveFailures++;
        if (!firstError) firstError = err.message;
        source.content = null;
        source.error = err.message;
        delete source.container;
        delete source.checkboxFound;
        delete source.isSelected;
        try { await goBackToSourcesList(); } catch (_) { /* ignore */ }
        if (consecutiveFailures >= maxEarlyFailures && i < maxEarlyFailures) {
          throw new Error(
            `Extraction aborted: the first ${maxEarlyFailures} sources all failed with "${firstError}". NotebookLM's page structure may have changed.`
          );
        }
      }
    }

    onProgress(active.length, active.length, 'Extraction complete!');
    return { sources, excludedCount };
  }

  function extractNotebookId() {
    const match = window.location.href.match(/\/notebook\/([a-f0-9-]{36})/i);
    return match ? match[1] : null;
  }

  function extractNotebookName() {
    try {
      const nb = document.querySelector('notebook');
      const header = nb?.querySelector('notebook-header');
      const title = header?.querySelector('.title-container .title span')?.textContent?.trim();
      if (title) return title;
    } catch (_) { /* ignore */ }
    const t = document.title;
    if (t?.includes(' - NotebookLM')) return t.replace(' - NotebookLM', '').trim();
    return t || 'Notebook Export';
  }

  async function startExtraction(sendProgress) {
    extractionCancelled = false;
    extractionActive = true;
    createOverlay();

    const onProgress = (current, total, message) => {
      updateOverlay(current, total, message);
      sendProgress?.({ current, total, message });
    };

    try {
      onProgress(0, 1, 'Navigating to sources list...');
      await ensureAtSourcesList();
      const { sources, excludedCount } = await extractAllSources(onProgress);
      if (extractionCancelled) {
        removeOverlay();
        extractionActive = false;
        return { cancelled: true };
      }
      removeOverlay();
      extractionActive = false;
      return {
        cancelled: false,
        data: {
          extractionInfo: {
            totalSources: sources.filter((s) => !s.excluded).length,
            excludedSources: excludedCount,
            extractedAt: new Date().toISOString(),
            url: window.location.href,
            notebookId: extractNotebookId(),
            notebookTitle: extractNotebookName(),
          },
          sources,
        },
      };
    } catch (err) {
      removeOverlay();
      extractionActive = false;
      if (extractionCancelled || err.message === 'Extraction cancelled by user') {
        return { cancelled: true };
      }
      throw err;
    }
  }

  function cancelExtraction() {
    extractionCancelled = true;
    removeOverlay();
    extractionActive = false;
  }

  global.plmSourcesScraper = {
    startExtraction,
    cancelExtraction,
    extractNotebookId,
    extractNotebookName,
    isExtractionActive: () => extractionActive,
  };
})(window);