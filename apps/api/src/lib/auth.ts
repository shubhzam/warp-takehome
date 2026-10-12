import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { AppError } from "./errors";

export type Role = "ADMIN" | "EMPLOYEE";
export type Ctx = { companyId: string; userId: string; role: Role };

// guid accepts any uuid shaped string, so hand written test ids work in curl
const headersSchema = z.object({
  "x-company-id": z.guid(),
  "x-user-id": z.string().min(1),
  "x-role": z.string().min(1),
});

// identity comes from headers for this demo, a real deployment would put a verified token here
// for an EMPLOYEE, x-user-id is the employee id
function readCtx(req: Request): Ctx {
  const parsed = headersSchema.safeParse({
    "x-company-id": req.header("x-company-id"),
    "x-user-id": req.header("x-user-id"),
    "x-role": req.header("x-role"),
  });
  if (!parsed.success) {
    throw new AppError(401, "UNAUTHENTICATED", "missing or invalid x-company-id, x-user-id or x-role header");
  }
  const role = parsed.data["x-role"];
  if (role !== "ADMIN" && role !== "EMPLOYEE") {
    throw new AppError(403, "FORBIDDEN", "unknown role");
  }
  return { companyId: parsed.data["x-company-id"], userId: parsed.data["x-user-id"], role };
}

// any known role may pass, the route decides what each role may do
export const requireUser: RequestHandler = (req, res, next) => {
  res.locals.ctx = readCtx(req);
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  const ctx = readCtx(req);
  if (ctx.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "admin role required");
  }
  res.locals.ctx = ctx;
  next();
};

export function getCtx(res: Response): Ctx {
  return res.locals.ctx as Ctx;
}