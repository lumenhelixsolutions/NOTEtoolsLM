const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  slugify,
  sanitizeZipEntryName,
  buildSourceMarkdown,
  buildSourcesZip,
  summarizeExport,
} = require('../lib/sources-export');

describe('sources-export', () => {
  it('slugify normalizes titles', () => {
    assert.equal(slugify('Hello World!'), 'hello-world');
    assert.equal(slugify(''), '');
  });

  it('sanitizeZipEntryName strips unsafe characters', () => {
    assert.equal(sanitizeZipEntryName('foo/bar:baz'), 'foo-bar-baz');
    assert.equal(sanitizeZipEntryName(''), 'source');
  });

  it('buildSourceMarkdown includes title, url, and body', () => {
    const md = buildSourceMarkdown({
      name: 'Article',
      url: 'https://example.com',
      content: 'Body text here.',
    });
    assert.match(md, /^# Article/);
    assert.match(md, /> https:\/\/example\.com/);
    assert.match(md, /Body text here\./);
  });

  it('buildSourcesZip produces a valid zip buffer', () => {
    const { zip, zipFilename, fileCount } = buildSourcesZip(
      [
        { name: 'One', content: 'First' },
        { name: 'Two', content: 'Second' },
      ],
      'My Notebook'
    );
    assert.ok(Buffer.isBuffer(zip));
    assert.equal(zip.slice(0, 4).toString(), 'PK\x03\x04');
    assert.equal(fileCount, 2);
    assert.match(zipFilename, /^my-notebook\.zip$/);
  });

  it('summarizeExport counts active and excluded sources', () => {
    const summary = summarizeExport({
      id: 'exp1',
      notebookId: 'nb1',
      notebookTitle: 'Test',
      excludedCount: 1,
      sources: [
        { name: 'A', content: 'x' },
        { name: 'B', excluded: true },
        { name: 'C', error: 'fail' },
      ],
    });
    assert.equal(summary.totalSources, 2);
    assert.equal(summary.excludedSources, 1);
    assert.equal(summary.withContent, 1);
    assert.equal(summary.errors, 1);
  });
});