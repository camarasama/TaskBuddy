import { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

// Validate request body, params, and query with Zod schema
export function validate(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate only the request body
/**
 * Accepts any `ZodType`, so a schema carrying cross-field `.refine()` rules can be used here — U17's "a team task needs two children" is the
 * first such rule. Only `parseAsync` is called, which every zod schema provides.
 */
export function validateBody(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.body);
      req.body = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate only query parameters
export function validateQuery(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.query);
      // Express 5 makes req.query a getter, so plain assignment throws in strict mode. Shadow it with
      // an own property so handlers see the parsed, coerced values exactly as before.
      Object.defineProperty(req, 'query', { value: validated, writable: true, configurable: true, enumerable: true });
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate only route parameters
export function validateParams(schema: ZodType) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.params = validated as Request['params'];
      next();
    } catch (error) {
      next(error);
    }
  };
}
