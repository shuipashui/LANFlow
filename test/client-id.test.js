import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientId } from '../public/client-id.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uses randomUUID when the browser provides it', () => {
  const expected = '12345678-1234-4123-8123-123456789abc';
  assert.equal(createClientId({ randomUUID: () => expected }), expected);
});

test('works on insecure mobile HTTP without randomUUID', () => {
  const id = createClientId({ getRandomValues: (bytes) => bytes.fill(7) });
  assert.match(id, uuidPattern);
});

test('still works when Web Crypto is unavailable', () => {
  assert.match(createClientId(undefined), uuidPattern);
});
