import type { createCalendarBody, setHolidaysBody } from "@repo/shared/schedule";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import type { HolidayCalendar, PrismaClient } from "../generated/prisma/client";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate } from "../lib/dates";
import { AppError } from "../lib/errors";

type CreateCalendarInput = z.infer<typeof createCalendarBody>;
type SetHolidaysInput = z.infer<typeof setHolidaysBody>;

// a transaction can take a while with a hundred holidays, same allowance as a big assignment
const BULK_TX_TIMEOUT_MS = 10_000;

const toCalendarDto = (c: HolidayCalendar) => ({ id: c.id, name: c.name, isDefault: c.isDefault });

function isUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// takes the calendar row lock, so two loads of one calendar take turns and each sees what the other left
async function lockCalendar(tx: Prisma.TransactionClient, ctx: Ctx, calendarId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM holiday_calendars WHERE id = ${calendarId}::uuid AND company_id = ${ctx.companyId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "calendar not found");
}

export async function createCalendar(prisma: PrismaClient, ctx: Ctx, input: CreateCalendarInput) {
  const id = uuidv7();
  try {
    return await prisma.$transaction(async (tx) => {
      const calendar = await tx.holidayCalendar.create({
        data: { id, companyId: ctx.companyId, name: input.name, isDefault: input.isDefault ?? false },
      });
      await writeAudit(tx, ctx, {
        action: "HOLIDAY_CALENDAR_CREATED",
        entityType: "holiday_calendar",
        entityId: id,
        after: { name: calendar.name, isDefault: calendar.isDefault },
      });
      return toCalendarDto(calendar);
    });
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    // two unique rules can fire, the name and one default per company, the name tells them apart
    const sameName = await prisma.holidayCalendar.findFirst({ where: { companyId: ctx.companyId, name: input.name } });
    if (sameName) throw new AppError(409, "DUPLICATE_NAME", `a calendar named "${input.name}" already exists`);
    throw new AppError(409, "DEFAULT_EXISTS", "this company already has a default calendar");
  }
}

export async function listCalendars(prisma: PrismaClient, ctx: Ctx) {
  const rows = await prisma.holidayCalendar.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { name: "asc" },
    include: { _count: { select: { holidays: true } } },
  });
  return rows.map((c) => ({ ...toCalendarDto(c), holidayCount: c._count.holidays }));
}

// all holidays of the calendar, or only the ones inside one year
export async function getCalendar(prisma: PrismaClient, ctx: Ctx, calendarId: string, year?: number) {
  const calendar = await prisma.holidayCalendar.findFirst({ where: { id: calendarId, companyId: ctx.companyId } });
  if (!calendar) throw new AppError(404, "NOT_FOUND", "calendar not found");
  const rows = await prisma.holiday.findMany({
    where: {
      calendarId,
      ...(year === undefined ? {} : { date: { gte: parseDate(`${year}-01-01`), lte: parseDate(`${year}-12-31`) } }),
    },
    orderBy: { date: "asc" },
  });
  return { calendar: toCalendarDto(calendar), holidays: rows.map((h) => ({ date: formatDate(h.date), name: h.name })) };
}

// adds new dates and renames existing ones, a date that already has the same name is left alone and not audited
export async function setHolidays(prisma: PrismaClient, ctx: Ctx, calendarId: string, input: SetHolidaysInput) {
  return prisma.$transaction(
    async (tx) => {
      await lockCalendar(tx, ctx, calendarId);

      const existing = await tx.holiday.findMany({
        where: { calendarId, date: { in: input.holidays.map((h) => parseDate(h.date)) } },
      });
      const nameByDate = new Map(existing.map((h): [string, string] => [formatDate(h.date), h.name]));

      const counts = { added: 0, updated: 0, unchanged: 0 };
      for (const holiday of input.holidays) {
        const oldName = nameByDate.get(holiday.date);
        if (oldName === holiday.name) {
          counts.unchanged += 1;
          continue;
        }
        const date = parseDate(holiday.date);
        await tx.holiday.upsert({
          where: { calendarId_date: { calendarId, date } },
          create: { calendarId, date, name: holiday.name },
          update: { name: holiday.name },
        });
        await writeAudit(tx, ctx, {
          action: "HOLIDAY_SET",
          entityType: "holiday_calendar",
          entityId: calendarId,
          ...(oldName === undefined ? {} : { before: { date: holiday.date, name: oldName } }),
          after: { date: holiday.date, name: holiday.name },
        });
        if (oldName === undefined) counts.added += 1;
        else counts.updated += 1;
      }
      return counts;
    },
    { timeout: BULK_TX_TIMEOUT_MS },
  );
}

// requests already priced keep their stored breakdown, only later submits see the change
export async function removeHoliday(prisma: PrismaClient, ctx: Ctx, calendarId: string, date: string) {
  return prisma.$transaction(async (tx) => {
    await lockCalendar(tx, ctx, calendarId);
    const key = { calendarId_date: { calendarId, date: parseDate(date) } };
    const holiday = await tx.holiday.findUnique({ where: key });
    if (!holiday) throw new AppError(404, "NOT_FOUND", `no holiday on ${date}`);

    await tx.holiday.delete({ where: key });
    const removed = { date, name: holiday.name };
    await writeAudit(tx, ctx, {
      action: "HOLIDAY_REMOVED",
      entityType: "holiday_calendar",
      entityId: calendarId,
      before: removed,
    });
    return removed;
  });
}
