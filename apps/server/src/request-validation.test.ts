import assert from 'node:assert/strict';
import test from 'node:test';

import { readPublicWidgetKey } from './request-validation.ts';

test('readPublicWidgetKey accepts a non-empty route param and trims transport whitespace', () => {
  assert.deepEqual(readPublicWidgetKey({ publicKey: ' demo-local-widget ' }), {
    status: 'valid',
    publicKey: 'demo-local-widget',
  });
});

test('readPublicWidgetKey rejects missing, blank, and non-string route params', () => {
  assert.deepEqual(readPublicWidgetKey({}), { status: 'invalid', reason: 'missing_public_key' });
  assert.deepEqual(readPublicWidgetKey({ publicKey: '   ' }), { status: 'invalid', reason: 'missing_public_key' });
  assert.deepEqual(readPublicWidgetKey({ publicKey: 123 }), { status: 'invalid', reason: 'invalid_public_key' });
});
