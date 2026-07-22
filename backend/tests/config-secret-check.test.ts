// validateConfig() refuses to boot on a weak HS256 signing secret (F-6). It early-returns in the
// test env, so these cases re-import config with NODE_ENV=production and a controlled env.
describe('validateConfig - JWT secret strength', () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  const baseEnv = {
    ...OLD_ENV,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/x',
    ADMIN_INVITE_CODE: 'code',
  };

  it('throws when JWT_SECRET is under 32 bytes', () => {
    jest.resetModules();
    process.env = { ...baseEnv, JWT_SECRET: 'too-short', JWT_REFRESH_SECRET: 'r'.repeat(40) };
    const { validateConfig } = require('../src/config');
    expect(() => validateConfig()).toThrow(/JWT_SECRET must be at least 32 bytes/i);
  });

  it('throws when JWT_REFRESH_SECRET is under 32 bytes', () => {
    jest.resetModules();
    process.env = { ...baseEnv, JWT_SECRET: 's'.repeat(40), JWT_REFRESH_SECRET: 'short' };
    const { validateConfig } = require('../src/config');
    expect(() => validateConfig()).toThrow(/JWT_REFRESH_SECRET must be at least 32 bytes/i);
  });

  it('passes when both secrets are at least 32 bytes', () => {
    jest.resetModules();
    process.env = { ...baseEnv, JWT_SECRET: 's'.repeat(40), JWT_REFRESH_SECRET: 'r'.repeat(40) };
    const { validateConfig } = require('../src/config');
    expect(() => validateConfig()).not.toThrow();
  });
});
