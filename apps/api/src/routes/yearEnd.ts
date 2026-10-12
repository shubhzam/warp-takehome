import { yearEndBody } from "@repo/shared/year-end";
import { Router } from "express";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { runYearEnd } from "../services/yearEnd";

export const yearEndRouter: Router = Router();

// POST /year-end-runs - always 200 with the counts, running the same year again is safe
yearEndRouter.post("/", async (req, res) => {
  res.json(await runYearEnd(prisma, getCtx(res), yearEndBody.parse(req.body)));
});