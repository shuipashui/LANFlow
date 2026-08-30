import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanFilename, safePath } from '../src/server.js';

test('safePath keeps paths inside the configured root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lantern-test-'));
  try {
    assert.equal(safePath(root, 'photos/2026'), join(root, 'photos', '2026'));
    assert.throws(() => safePath(root, '../secret.txt'), /禁止访问/);
    assert.throws(() => safePath(root, '%2e%2e%2fsecret.txt'), /禁止访问/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('cleanFilename removes path and Windows-invalid characters', () => {
  assert.equal(cleanFilename('../report:final?.pdf'), 'report_final_.pdf');
  assert.equal(cleanFilename('photo.jpg'), 'photo.jpg');
});
