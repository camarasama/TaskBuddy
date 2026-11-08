import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { jwtVerifyOptions } from '../utils/jwt';
import { AppError } from './errorHandler';
import { isBlockedForDemo, isDemoFamily } from '../services/demoAccount';
import type { TokenPayload } from './auth';

export const DEMO_BLOCKED_MESSAGE =
  'This is the public demo account, so this action is turned off. Create your own free account to try it.';

/**
 * Refuses DEMO_BLOCKED_ROUTES for the public demo family (see services/demoAccount.ts).
 *
 * Mounted once on /api/v1, ahead of every router, so a new router cannot forget it. It only reads
 * the token for a request that matches the list. Anything it cannot verify passes through
 * untouched: authentication is still the route's own job, and this must never turn a 401 into a
 * 403 or block a real family.
 */
export async function demoGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!isBlockedForDemo(req.method, req.path)) return next();

    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next();

    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, config.jwt.secret, jwtVerifyOptions) as TokenPayload;
    } catch {
      return next();
    }

    if (await isDemoFamily(payload.familyId)) {
      return next(new AppError(403, 'DEMO_READ_ONLY', DEMO_BLOCKED_MESSAGE));
    }
    next();
  } catch (error) {
    next(error);
  }
}
