import { listAuditQuery } from "@repo/shared/audit";
import { Router } from "express";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { listAuditEvents } from "../services/audit";

export const auditRouter: Router = Router();

// GET /audit-events?entityType=&entityId=&action=&limit=&beforeId= - newest first, nextBeforeId is null on the last page
auditRouter.get("/", async (req, res) => {
  res.json(await listAuditEvents(prisma, getCtx(res), listAuditQuery.parse(req.query)));
});
