import { Router } from "express";
import { z } from "zod";
import { accrualRunBody, adjustmentBody } from "@repo/shared/ledger";
import { prisma } from "../lib/db";
import { getCtx } from "../lib/auth";
import { runAccrual, createAdjustment, listBalances, listLedger } from "../services/ledger";

// three small routers so each one can be mounted behind requireAdmin on its own path
export const accrualRunsRouter: Router = Router();
export const adjustmentsRouter: Router = Router();
export const employeeLedgerRouter: Router = Router();

const ledgerQuery = z.object({ policyId: z.guid().optional() });

// POST /accrual-runs - month end job, safe to call again for the same period
accrualRunsRouter.post("/", async (req, res) => {
  const { period } = accrualRunBody.parse(req.body);
  res.json(await runAccrual(prisma, getCtx(res), period));
});

// POST /adjustments - 201 for a new entry, 200 when the same key replays the same content
adjustmentsRouter.post("/", async (req, res) => {
  const input = adjustmentBody.parse(req.body);
  const { entry, replayed } = await createAdjustment(prisma, getCtx(res), input);
  res.status(replayed ? 200 : 201).json(entry);
});

// GET /employees/:employeeId/balances
employeeLedgerRouter.get("/:employeeId/balances", async (req, res) => {
  res.json(await listBalances(prisma, getCtx(res), req.params.employeeId));
});

// GET /employees/:employeeId/ledger?policyId=
employeeLedgerRouter.get("/:employeeId/ledger", async (req, res) => {
  const { policyId } = ledgerQuery.parse(req.query);
  res.json(await listLedger(prisma, getCtx(res), req.params.employeeId, policyId));
});