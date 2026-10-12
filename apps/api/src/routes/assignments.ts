import { endAssignmentBody } from "@repo/shared/policy";
import { Router } from "express";
import { z } from "zod";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { endAssignment, listEmployeeAssignments } from "../services/assignments";

// mounted at /assignments
export const assignmentsRouter : Router = Router();

assignmentsRouter.patch("/:id", async (req, res) => {
  const id = z.guid().parse(req.params.id);
  const input = endAssignmentBody.parse(req.body);
  res.json(await endAssignment(prisma, getCtx(res), id, input));
});

// mounted at /employees
export const employeesRouter : Router = Router();

employeesRouter.get("/:employeeId/assignments", async (req, res) => {
  const employeeId = z.string().min(1).parse(req.params.employeeId);
  res.json(await listEmployeeAssignments(prisma, getCtx(res), employeeId));
});