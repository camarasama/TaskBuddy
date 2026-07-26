import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, ZodTypeAny } from 'zod';

// Validate request body, params, and query with Zod schema
export function validate(schema: AnyZodObject) {
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
 * Accepts `ZodTypeAny`, not just `AnyZodObject`, so a schema carrying cross-field `.refine()` rules
 * (which zod types as `ZodEffects`) can be used here — U17's "a team task needs two children" is the
 * first such rule. Only `parseAsync` is called, which every zod schema provides.
 */
export function validateBody(schema: ZodTypeAny) {
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
export function validateQuery(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.query);
      req.query = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate only route parameters
export function validateParams(schema: AnyZodObject) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.params = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}
