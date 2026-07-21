// Run: node --test src/lib/format.test.ts   (Node 24+ strips TS natively)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalPair, formatDuration } from './format.ts';

test('formatDuration: pads seconds and rolls into minutes', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(9), '0:09');
  assert.equal(formatDuration(59), '0:59');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(75), '1:15'); // the >59s bug this guards against
  assert.equal(formatDuration(3.9), '0:03'); // floors, no rounding up
  assert.equal(formatDuration(-5), '0:00'); // clamps negatives
});

test('canonicalPair: same unordered pair maps to one ordered row', () => {
  const a = canonicalPair('aaa', 'bbb');
  const b = canonicalPair('bbb', 'aaa');
  assert.deepEqual(a, { user_a: 'aaa', user_b: 'bbb' });
  assert.deepEqual(a, b); // order-independent — the whole point
});
