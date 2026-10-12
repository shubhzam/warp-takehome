import { assignBody, createPolicyBody, createVersionBody } from "@repo/shared/policy";
import { Router } from "express";
import { z } from "zod";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { assignEmployees, listPolicyAssignments } from "../services/assignments";
import { createPolicy, createVersion, getPolicy, listPolicies } from "../services/policies";

const idSchema = z.guid();
const asOfSchema = z.iso.date().optional();

export const policiesRouter : Router = Router();

policiesRouter.post("/", async (req, res) => {
  const input = createPolicyBody.parse(req.body);
  res.status(201).json(await createPolicy(prisma, getCtx(res), input));
});

policiesRouter.get("/", async (_req, res) => {
  res.json(await listPolicies(prisma, getCtx(res)));
});

policiesRouter.get("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const asOf = asOfSchema.parse(req.query.asOf);
  res.json(await getPolicy(prisma, getCtx(res), id, asOf));
});

policiesRouter.post("/:id/versions", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = createVersionBody.parse(req.body);
  res.status(201).json(await createVersion(prisma, getCtx(res), id, input));
});

policiesRouter.get("/:id/assignments", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  res.json(await listPolicyAssignments(prisma, getCtx(res), id));
});

policiesRouter.post("/:id/assignments", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = assignBody.parse(req.body);
  res.status(201).json(await assignEmployees(prisma, getCtx(res), id, input));
});