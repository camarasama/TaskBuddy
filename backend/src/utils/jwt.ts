import jwt from 'jsonwebtoken';

// Pinning the issuer and audience means a token minted for one purpose (or by a different system
// sharing the secret) is not silently accepted here. Pinning the algorithm blocks the classic
// jsonwebtoken foot-guns: `alg: none` and HS/RS confusion where an attacker submits an HS256 token
// signed with a public key the server treats as an RS256 verification key.
export const JWT_ISSUER = 'taskbuddy-api';
export const JWT_AUDIENCE = 'taskbuddy';

/** Options every jwt.verify MUST pass. */
export const jwtVerifyOptions: jwt.VerifyOptions = {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

/** Options every jwt.sign MUST include so the token satisfies jwtVerifyOptions. */
export const jwtSignOptions: jwt.SignOptions = {
  algorithm: 'HS256',
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

// F-9: the MFA challenge token bridges "password verified" → "TOTP verified". It carries a distinct
// audience so it is NOT accepted by authenticate() (which pins audience=taskbuddy) — a stolen mfaToken
// cannot be used as a session token, only exchanged at POST /auth/mfa.
export const JWT_MFA_AUDIENCE = 'taskbuddy-mfa';

export function signMfaToken(userId: string, secret: string): string {
  return jwt.sign({ userId, mfa: 'pending' }, secret, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_MFA_AUDIENCE,
    expiresIn: '5m',
  });
}

export function verifyMfaToken(token: string, secret: string): { userId: string } {
  const payload = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_MFA_AUDIENCE,
  }) as { userId: string };
  return payload;
}
