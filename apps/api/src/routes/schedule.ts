import { createCalendarBody, setHolidaysBody } from "@repo/shared/schedule";
import { Router } from "express";
import { z } from "zod";
import { getCtx } from "../lib/auth";
import { prisma } from "../lib/db";
import { createCalendar, getCalendar, listCalendars, removeHoliday, setHolidays } from "../services/schedule";

const idParam = z.guid();
const dateParam = z.iso.date();
const yearQuery = z.coerce.number().int().min(2000).max(2100).optional();

// mounted at /holiday-calendars
export const calendarsRouter: Router = Router();

calendarsRouter.post("/", async (req, res) => {
  res.status(201).json(await createCalendar(prisma, getCtx(res), createCalendarBody.parse(req.body)));
});

calendarsRouter.get("/", async (_req, res) => {
  res.json(await listCalendars(prisma, getCtx(res)));
});

// GET /holiday-calendars/:id?year= - every holiday, or the ones inside one year
calendarsRouter.get("/:id", async (req, res) => {
  const year = yearQuery.parse(req.query.year);
  res.json(await getCalendar(prisma, getCtx(res), idParam.parse(req.params.id), year));
});

// PUT /holiday-calendars/:id/holidays - counts of added, updated and unchanged dates, loading twice is safe
calendarsRouter.put("/:id/holidays", async (req, res) => {
  const input = setHolidaysBody.parse(req.body);
  res.json(await setHolidays(prisma, getCtx(res), idParam.parse(req.params.id), input));
});

calendarsRouter.delete("/:id/holidays/:date", async (req, res) => {
  const date = dateParam.parse(req.params.date);
  res.json(await removeHoliday(prisma, getCtx(res), idParam.parse(req.params.id), date));
});
