import {
  readCredentials,
  saveCredentials,
  clearCredentials,
  clearChildName,
  shouldLockAfterHidden,
  CHILD_IDLE_MS,
  STORAGE_KEY_FAMILY_CODE,
  STORAGE_KEY_NAME,
} from '../src/lib/childSession';

/** Minimal in-memory Storage stand-in (frontend jest runs in node, no real localStorage). */
function makeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

describe('childSession credential helpers', () => {
  it('reads saved credentials only when BOTH code and name are present', () => {
    expect(readCredentials(makeStore())).toBeNull();
    expect(readCredentials(makeStore({ [STORAGE_KEY_FAMILY_CODE]: 'FAM-LION-0001' }))).toBeNull();
    expect(readCredentials(makeStore({ [STORAGE_KEY_NAME]: 'Sam' }))).toBeNull();

    const store = makeStore({ [STORAGE_KEY_FAMILY_CODE]: 'FAM-LION-0001', [STORAGE_KEY_NAME]: 'Sam' });
    expect(readCredentials(store)).toEqual({ familyCode: 'FAM-LION-0001', childName: 'Sam' });
  });

  it('saveCredentials writes both keys', () => {
    const store = makeStore();
    saveCredentials(store, 'FAM-LION-0001', 'Sam');
    expect(store.getItem(STORAGE_KEY_FAMILY_CODE)).toBe('FAM-LION-0001');
    expect(store.getItem(STORAGE_KEY_NAME)).toBe('Sam');
  });

  it('clearCredentials (full reset) forgets BOTH the family code and the name', () => {
    const store = makeStore({ [STORAGE_KEY_FAMILY_CODE]: 'FAM-LION-0001', [STORAGE_KEY_NAME]: 'Sam' });
    clearCredentials(store);
    expect(store.getItem(STORAGE_KEY_FAMILY_CODE)).toBeNull();
    expect(store.getItem(STORAGE_KEY_NAME)).toBeNull();
  });

  it('clearChildName (switch child) KEEPS the family code, forgets only the name', () => {
    const store = makeStore({ [STORAGE_KEY_FAMILY_CODE]: 'FAM-LION-0001', [STORAGE_KEY_NAME]: 'Sam' });
    clearChildName(store);
    expect(store.getItem(STORAGE_KEY_FAMILY_CODE)).toBe('FAM-LION-0001'); // family code retained
    expect(store.getItem(STORAGE_KEY_NAME)).toBeNull(); // name cleared → prompts for a new child
  });
});

describe('shouldLockAfterHidden (idle/background soft-logout)', () => {
  it('does not lock when the tab was never hidden this cycle', () => {
    expect(shouldLockAfterHidden(null, Date.now())).toBe(false);
  });

  it('does not lock when hidden for less than the idle window', () => {
    const hiddenAt = 1_000_000;
    expect(shouldLockAfterHidden(hiddenAt, hiddenAt + CHILD_IDLE_MS - 1)).toBe(false);
  });

  it('locks when hidden for at least the idle window', () => {
    const hiddenAt = 1_000_000;
    expect(shouldLockAfterHidden(hiddenAt, hiddenAt + CHILD_IDLE_MS)).toBe(true);
  });

  it('the idle window is 10 minutes', () => {
    expect(CHILD_IDLE_MS).toBe(10 * 60 * 1000);
  });
});
