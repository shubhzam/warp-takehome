import { createRequestBody, decisionBody, listRequestsQuery, rejectBody } from "@repo/shared/requests";
import { previewQuery } from "@repo/shared/schedule";
import { Router } from "express";
import { z } from "zod";
import { getCtx, requireAdmin } from "../lib/auth";
import { prisma } from "../lib/db";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  getRequest,
  listRequests,
  previewRequest,
  rejectRequest,
} from "../services/requests";

export const requestsRouter: Router = Router();

// a bad id is a 400 here, not a database cast error later
const idParam = z.guid();

// POST /requests - 201 for a new request, 200 when the same key replays the same content
requestsRouter.post("/", async (req, res) => {
  const { request, replayed } = await createRequest(prisma, getCtx(res), createRequestBody.parse(req.body));
  res.status(replayed ? 200 : 201).json(request);
});

// GET /requests?status=&employeeId= - employees only get their own
requestsRouter.get("/", async (req, res) => {
  res.json(await listRequests(prisma, getCtx(res), listRequestsQuery.parse(req.query)));
});

// GET /requests/preview?employeeId=&startDate=&endDate= - what a submit would cost, must come before /:id
requestsRouter.get("/preview", async (req, res) => {
  res.json(await previewRequest(prisma, getCtx(res), previewQuery.parse(req.query)));
});

requestsRouter.get("/:id", async (req, res) => {
  res.json(await getRequest(prisma, getCtx(res), idParam.parse(req.params.id)));
});

// approve and reject are admin only, cancel is for the owner or an admin
requestsRouter.post("/:id/approve", requireAdmin, async (req, res) => {
  const input = decisionBody.parse(req.body ?? {});
  res.json(await approveRequest(prisma, getCtx(res), idParam.parse(req.params.id), input));
});

requestsRouter.post("/:id/reject", requireAdmin, async (req, res) => {
  const input = rejectBody.parse(req.body);
  res.json(await rejectRequest(prisma, getCtx(res), idParam.parse(req.params.id), input));
});

requestsRouter.post("/:id/cancel", async (req, res) => {
  const input = decisionBody.parse(req.body ?? {});
  res.json(await cancelRequest(prisma, getCtx(res), idParam.parse(req.params.id), input));
});