import { employeeIdParam, setStartDateBody } from "@repo/shared/tenure";
import { Router } from "express";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { getStartDate, setStartDate } from "../services/tenure";

export const startDatesRouter: Router = Router();

// GET /employees/:employeeId/start-date - startDate is null when none is recorded
startDatesRouter.get("/:employeeId/start-date", async (req, res) => {
  res.json(await getStartDate(prisma, getCtx(res), employeeIdParam.parse(req.params.employeeId)));
});

// PUT /employees/:employeeId/start-date - sets or replaces the date, only accruals not yet posted use it
startDatesRouter.put("/:employeeId/start-date", async (req, res) => {
  const employeeId = employeeIdParam.parse(req.params.employeeId);
  res.json(await setStartDate(prisma, getCtx(res), employeeId, setStartDateBody.parse(req.body)));
});