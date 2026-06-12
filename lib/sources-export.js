/**
 * NotebookLM source → Markdown / ZIP export utilities.
 * Inspired by NotebookLM Sources Exporter (toolboxspace.com) — reimplemented for NOTEtoolsLM.
 */

const { buildZip } = require('./zip-export');

function slugify(name) {
  return String(name || '')
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 100);
}

function sanitizeZipEntryName(name) {
  const cleaned = String(name || 'source')
    .replace(/[/\\:*?"<>|\x00-\x1F]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]|[-.]$/g, '')
    .slice(0, 200);
  return cleaned || 'source';
}

function buildSourceMarkdown(source) {
  const title = source.name || source.title || 'Untitled Source';
  const lines = [`# ${title}`];

  if (source.url) {
    lines.push('', `> ${source.url}`);
  }
  if (source.videoUrl) {
    lines.push('', `> Video: ${source.videoUrl}`);
  }

  const body = (source.content || '').trim();
  if (body) {
    lines.push('', body);
  } else if (source.imageUrl) {
    lines.push('', `![image](${source.imageUrl})`);
  }

  return lines.join('\n').trim() + '\n';
}

function uniqueMdFilename(baseName, used) {
  const slug = slugify(baseName) || 'source';
  const count = (used.get(slug) || 0) + 1;
  used.set(slug, count);
  return count === 1 ? `${slug}.md` : `${slug}-${count}.md`;
}

function buildSourcesZip(sources, notebookTitle = 'notebooklm-sources-export') {
  const used = new Map();
  const entries = [];

  for (const source of sources || []) {
    if (source.excluded) continue;
    const name = sanitizeZipEntryName(source.name || source.title || 'source');

    if (source.isImageSource && source.imageUrl) {
      entries.push({
        name: `${name}.md`,
        data: Buffer.from(buildSourceMarkdown(source), 'utf8'),
      });
      if (source.imageData && source.imageData.length) {
        entries.push({
          name: name,
          data: Buffer.from(source.imageData),
        });
      }
    } else {
      const mdName = uniqueMdFilename(source.name || source.title, used);
      entries.push({
        name: mdName,
        data: Buffer.from(buildSourceMarkdown(source), 'utf8'),
      });
    }
  }

  const zipFilename = `${slugify(notebookTitle) || 'notebooklm-sources-export'}.zip`;
  return {
    zip: buildZip(entries),
    zipFilename,
    fileCount: entries.length,
  };
}

function summarizeExport(exportRecord) {
  const sources = exportRecord?.sources || [];
  const active = sources.filter((s) => !s.excluded);
  return {
    id: exportRecord?.id,
    notebookId: exportRecord?.notebookId,
    notebookTitle: exportRecord?.notebookTitle,
    extractedAt: exportRecord?.extractedAt,
    totalSources: active.length,
    excludedSources: exportRecord?.excludedCount || sources.filter((s) => s.excluded).length,
    withContent: active.filter((s) => s.content || s.imageUrl).length,
    errors: active.filter((s) => s.error).length,
  };
}

module.exports = {
  slugify,
  sanitizeZipEntryName,
  buildSourceMarkdown,
  buildSourcesZip,
  summarizeExport,
};