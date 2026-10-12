import { Router } from "express";
import { z } from "zod";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { listBalances, listLedger } from "../services/ledger";
import { listMyAssignments } from "../services/me";

// mounted at /me, always answers for the caller so there is no employee id to forge
export const meRouter: Router = Router();

const ledgerQuery = z.object({ policyId: z.guid().optional() });

meRouter.get("/assignments", async (_req, res) => {
  res.json(await listMyAssignments(prisma, getCtx(res)));
});

meRouter.get("/balances", async (_req, res) => {
  const ctx = getCtx(res);
  res.json(await listBalances(prisma, ctx, ctx.userId));
});

meRouter.get("/ledger", async (req, res) => {
  const ctx = getCtx(res);
  const { policyId } = ledgerQuery.parse(req.query);
  res.json(await listLedger(prisma, ctx, ctx.userId, policyId));
});
