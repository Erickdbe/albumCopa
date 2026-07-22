import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@brfut/db";

/**
 * Last middleware in the chain (4 args = Express error handler). Logs the
 * real error server-side but never leaks internals (stack traces, DB
 * connection strings, file paths) to the client — only a generic message
 * plus whatever status code fits.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  console.error("[unhandled error]", err);

  if (res.headersSent) return;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Resource already exists" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
  }

  res.status(500).json({ error: "Internal server error" });
}
