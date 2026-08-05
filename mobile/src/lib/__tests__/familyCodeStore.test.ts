/**
 * The QR payload format and the stored family code.
 *
 * `parseJoinLink` is the interesting half. A camera points at whatever is in frame, so this function is
 * the only thing standing between a cereal box barcode and a child's device storing nonsense and then
 * failing at login with a message that blames the wrong thing. Its strictness is the feature.
 *
 * The import below sits above the `jest.mock` calls only because the linter wants it there —
 * babel-plugin-jest-hoist lifts every `jest.mock` above the imports regardless, so the mocks are in
 * place before `familyCodeStore` is evaluated.
 */
import {
  buildJoinLink,
  getStoredFamilyCode,
  parseJoinLink,
  setStoredFamilyCode,
} from '../familyCodeStore';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.test/api/v1',
        clientPlatform: 'taskbuddy-android',
        clientVersion: '0.1.0',
      },
    },
  },
}));

const mockKeystore = new Map<string, string>();
let mockFailNextWrite = false;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockKeystore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockFailNextWrite) throw new Error('keystore unavailable');
    mockKeystore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeystore.delete(key);
  }),
}));

beforeEach(() => {
  mockKeystore.clear();
  mockFailNextWrite = false;
});

describe('buildJoinLink', () => {
  it('produces a scheme-qualified link, not a bare code', () => {
    // A bare code would let the scanner accept any QR in the world.
    expect(buildJoinLink('ABC123')).toBe('taskbuddy://join?code=ABC123');
  });

  it('normalises case and whitespace before encoding', () => {
    expect(buildJoinLink('  abc123 ')).toBe('taskbuddy://join?code=ABC123');
  });

  it('round-trips through the parser', () => {
    expect(parseJoinLink(buildJoinLink('XY7Z2Q'))).toBe('XY7Z2Q');
  });
});

describe('parseJoinLink', () => {
  it('rejects anything that is not one of our links', () => {
    // The realistic inputs: a URL on a poster, a WiFi sticker, a bare code from an older format.
    expect(parseJoinLink('https://example.com')).toBeNull();
    expect(parseJoinLink('WIFI:S:HomeNet;T:WPA;P:hunter2;;')).toBeNull();
    expect(parseJoinLink('ABC123')).toBeNull();
    expect(parseJoinLink('')).toBeNull();
  });

  it('rejects our scheme with a different action', () => {
    expect(parseJoinLink('taskbuddy://reset?code=ABC123')).toBeNull();
  });

  it('rejects a link with no code parameter', () => {
    expect(parseJoinLink('taskbuddy://join?other=1')).toBeNull();
  });

  it('rejects an empty code rather than storing one', () => {
    // Storing '' would flip the login screen into its onboarded shape — hiding the family-code field
    // with nothing behind it, leaving no way to sign in at all.
    expect(parseJoinLink('taskbuddy://join?code=')).toBeNull();
    expect(parseJoinLink('taskbuddy://join?code=%20%20')).toBeNull();
  });

  it('survives a malformed percent-escape instead of throwing into the scanner', () => {
    // decodeURIComponent throws on a lone '%'. Uncaught, that would crash the barcode handler.
    expect(parseJoinLink('taskbuddy://join?code=%E0%A4%A')).toBeNull();
  });

  it('tolerates extra parameters, so a future field does not break old devices', () => {
    expect(parseJoinLink('taskbuddy://join?code=ABC123&v=2')).toBe('ABC123');
    expect(parseJoinLink('taskbuddy://join?v=2&code=ABC123')).toBe('ABC123');
  });

  it('normalises what it returns', () => {
    expect(parseJoinLink('taskbuddy://join?code=abc123')).toBe('ABC123');
  });
});

describe('storage', () => {
  it('stores nothing until a code is scanned', async () => {
    expect(await getStoredFamilyCode()).toBeNull();
  });

  it('round-trips a code, normalised', async () => {
    expect(await setStoredFamilyCode(' abc123 ')).toBe(true);
    expect(await getStoredFamilyCode()).toBe('ABC123');
  });

  it('forgets on null, for a device handed to a sibling', async () => {
    await setStoredFamilyCode('ABC123');

    expect(await setStoredFamilyCode(null)).toBe(true);
    expect(await getStoredFamilyCode()).toBeNull();
  });

  it('reports a failed write rather than pretending it landed', async () => {
    // The scanner relies on this: a silent failure would send the child to a login screen that has
    // hidden its family-code field having stored nothing.
    mockFailNextWrite = true;

    expect(await setStoredFamilyCode('ABC123')).toBe(false);
    expect(await getStoredFamilyCode()).toBeNull();
  });
});
