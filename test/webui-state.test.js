import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/webui/ui-state.js');
const { createHarnessExpansionState } = module;

test('harness expansion state survives dashboard refreshes and reloads', () => {
  assert.equal(typeof createHarnessExpansionState, 'function', 'persistent harness state must exist');
  if (!createHarnessExpansionState) return;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = createHarnessExpansionState(storage);
  assert.equal(first.isExpanded('generation'), false);
  first.setExpanded('generation', true);
  assert.equal(first.isExpanded('generation'), true);

  const reloaded = createHarnessExpansionState(storage);
  assert.equal(reloaded.isExpanded('generation'), true);
});
