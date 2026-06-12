const { describe, it } = require('node:test');
const assert = require('node:assert');
const { buildZip } = require('../lib/zip-export');

describe('zip-export', () => {
  it('builds a valid zip buffer with manifest entry', () => {
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from('{"ok":true}', 'utf8') },
      { name: 'files/readme.md', data: Buffer.from('# hello', 'utf8') },
    ]);
    assert.ok(Buffer.isBuffer(zip));
    assert.ok(zip.length > 50);
    assert.ok(zip.slice(0, 4).toString() === 'PK\x03\x04');
  });
});