import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from './errorHandler';
import type { UserRole } from '@taskbuddy/shared';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      familyId?: string;
    }
  }
}

export interface TokenPayload {
  userId: string;
  familyId: string;
  role: UserRole;
  ageGroup?: string;
  iat?: number;
  exp?: number;
}

// Verify JWT token
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    // Get token from header or cookie
    let token = req.headers.authorization?.split(' ')[1];

    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new UnauthorizedError('No authentication token provided');
    }

    // Verify token
    const payload = jwt.verify(token, config.jwt.secret) as TokenPayload;

    // Attach user info to request
    req.user = payload;
    req.familyId = payload.familyId;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token has expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

// Optional authentication (doesn't fail if no token)
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    let token = req.headers.authorization?.split(' ')[1];

    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      const payload = jwt.verify(token, config.jwt.secret) as TokenPayload;
      req.user = payload;
      req.familyId = payload.familyId;
    }

    next();
  } catch {
    // Ignore errors for optional auth
    next();
  }
}

// Require specific roles
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
}

// Require parent role
export const requireParent = requireRole('parent', 'admin');

// Require child role
export const requireChild = requireRole('child');

// Require any authenticated user
export const requireAuth = requireRole('parent', 'child', 'admin');

// Family isolation middleware - ensures users can only access their family's data
export function familyIsolation(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }

  // Check if request tries to access another family's data
  const requestedFamilyId = req.params.familyId || req.body?.familyId || req.query?.familyId;

  if (requestedFamilyId && requestedFamilyId !== req.user.familyId) {
    next(new ForbiddenError('Access to other families is forbidden'));
    return;
  }

  // Ensure familyId is always available
  req.familyId = req.user.familyId;

  next();
}
