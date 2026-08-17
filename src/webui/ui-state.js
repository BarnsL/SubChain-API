// Small, serializable UI preferences. Server refreshes never reset a user's open Harness sections.

const HARNESS_STORAGE_KEY = 'subchain.harness.expanded.v1';

function read(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(HARNESS_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

export function createHarnessExpansionState(storage = globalThis.localStorage) {
  const expanded = read(storage);
  const save = () => storage.setItem(HARNESS_STORAGE_KEY, JSON.stringify([...expanded].sort()));
  return {
    isExpanded(key) { return expanded.has(key); },
    setExpanded(key, value) {
      if (value) expanded.add(key);
      else expanded.delete(key);
      save();
    },
  };
}
