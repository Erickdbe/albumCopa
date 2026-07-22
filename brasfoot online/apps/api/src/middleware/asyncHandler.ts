import type { NextFunction, Request, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Express 4 does not catch rejected promises from async route handlers —
 * an uncaught error inside one becomes an unhandled rejection that crashes
 * the whole process (verified: a transient DB error took down the entire
 * API, not just the one request). Wrapping every async handler in this
 * forwards the error to next() so the global error handler can respond
 * instead of the process dying.
 */
export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
