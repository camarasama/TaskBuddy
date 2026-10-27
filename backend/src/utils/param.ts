/**
 * utils/param.ts - read one route parameter as a string (Express 5, 2026-10-27).
 *
 * Express 5 types every route parameter as `string | string[]`, because a named wildcard
 * (`/*path`) yields an array. Our routes only use plain `:id`-style segments, which are always a
 * single string, but the type is now honest about the general case. This turns that into a checked
 * string instead of 128 unchecked casts: anything that is not a non-empty string is a 400.
 */

import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler';

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(400, 'INVALID_PARAMETER', `Missing or invalid route parameter: ${name}`);
  }
  return value;
}
