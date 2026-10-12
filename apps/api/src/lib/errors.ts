import type { ErrorRequestHandler } from "express";
import { z } from "zod";

// every expected failure is thrown as one of these and the handler below turns it into the shared error shape
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: z.prettifyError(err) } });
    return;
  }
  const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`unhandled error: ${reason}`);
  res.status(500).json({ error: { code: "INTERNAL", message: "something went wrong" } });
};