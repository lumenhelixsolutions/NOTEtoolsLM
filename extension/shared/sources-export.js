// Browser ES module mirror of lib/sources-export.js

export function slugify(name) {
  return String(name || '')
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 100);
}

export function sanitizeZipEntryName(name) {
  const cleaned = String(name || 'source')
    .replace(/[/\\:*?"<>|\x00-\x1F]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]|[-.]$/g, '')
    .slice(0, 200);
  return cleaned || 'source';
}

export function buildSourceMarkdown(source) {
  const title = source.name || source.title || 'Untitled Source';
  const lines = [`# ${title}`];

  if (source.url) lines.push('', `> ${source.url}`);
  if (source.videoUrl) lines.push('', `> Video: ${source.videoUrl}`);

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

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concatChunks(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const entry of entries) {
    const nameBuf = enc.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : enc.encode(entry.data);
    const crc = crc32(data);
    const local = concatChunks([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
      nameBuf, data,
    ]);
    parts.push(local);
    central.push(concatChunks([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf,
    ]));
    offset += local.length;
  }

  const centralBuf = concatChunks(central);
  const end = concatChunks([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuf.length), u32(offset), u16(0),
  ]);
  return concatChunks([...parts, centralBuf, end]);
}

export function buildSourcesZip(sources, notebookTitle = 'notebooklm-sources-export', imageMap = null) {
  const used = new Map();
  const entries = [];

  for (const source of sources || []) {
    if (source.excluded) continue;
    const name = sanitizeZipEntryName(source.name || source.title || 'source');

    if (source.isImageSource && source.imageUrl) {
      entries.push({ name: `${name}.md`, data: buildSourceMarkdown(source) });
      const img = imageMap?.get(source.name || source.title);
      if (img) entries.push({ name, data: img });
    } else {
      entries.push({
        name: uniqueMdFilename(source.name || source.title, used),
        data: buildSourceMarkdown(source),
      });
    }
  }

  return {
    zipBytes: buildZip(entries.map((e) => ({
      name: e.name,
      data: typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data,
    }))),
    zipFilename: `${slugify(notebookTitle) || 'notebooklm-sources-export'}.zip`,
    fileCount: entries.length,
  };
}

export function summarizeExport(exportRecord) {
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