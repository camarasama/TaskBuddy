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
