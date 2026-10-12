import { payrollAccrualBody } from "@repo/shared/payroll";
import { Router } from "express";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { runPayrollAccrual } from "../services/payroll";

export const payrollRouter: Router = Router();

// POST /payroll-accruals - always 200 with the counts, sending the same file again is safe
payrollRouter.post("/", async (req, res) => {
  res.json(await runPayrollAccrual(prisma, getCtx(res), payrollAccrualBody.parse(req.body)));
});