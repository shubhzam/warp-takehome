import type { createCalendarBody, setHolidaysBody, setWorkScheduleBody } from "@repo/shared/schedule";
import { Decimal } from "decimal.js";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import type { EmployeeWorkSchedule, HolidayCalendar, PrismaClient } from "../generated/prisma/client";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate, todayUtc } from "../lib/dates";
import { AppError } from "../lib/errors";
import { type ScheduleRow, priceRange, standardSchedule } from "../lib/schedule";

type CreateCalendarInput = z.infer<typeof createCalendarBody>;
type SetHolidaysInput = z.infer<typeof setHolidaysBody>;
type SetScheduleInput = z.infer<typeof setWorkScheduleBody>;

// source says where the numbers came from, STANDARD is the fallback when no row is in force and has no id or start
export type ScheduleDto = {
  id: string | null;
  employeeId: string;
  effectiveFrom: string | null;
  hoursPerDay: string;
  workDays: number[];
  calendarId: string | null;
  source: "SCHEDULE" | "STANDARD";
};

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

const toScheduleDto = (r: EmployeeWorkSchedule): ScheduleDto => ({
  id: r.id,
  employeeId: r.employeeId,
  effectiveFrom: formatDate(r.effectiveFrom),
  hoursPerDay: r.hoursPerDay.toFixed(4),
  workDays: r.workDays,
  calendarId: r.calendarId,
  source: "SCHEDULE",
});

const toStandardDto = (employeeId: string): ScheduleDto => ({
  id: null,
  employeeId,
  effectiveFrom: null,
  hoursPerDay: new Decimal(standardSchedule.hoursPerDay).toFixed(4),
  workDays: standardSchedule.workDays,
  calendarId: standardSchedule.calendarId,
  source: "STANDARD",
});

// what the audit row keeps of a schedule, the effective date is part of the row identity
const toAuditValues = (r: EmployeeWorkSchedule) => ({
  employeeId: r.employeeId,
  effectiveFrom: formatDate(r.effectiveFrom),
  hoursPerDay: r.hoursPerDay.toFixed(4),
  workDays: r.workDays,
  calendarId: r.calendarId,
});

// the schedule in force on a day plus every row, newest first, the standard schedule when nothing is in force yet
export async function getWorkSchedule(prisma: PrismaClient, ctx: Ctx, employeeId: string, asOf?: string) {
  const day = asOf ?? todayUtc();
  const rows = await prisma.employeeWorkSchedule.findMany({
    where: { companyId: ctx.companyId, employeeId },
    orderBy: { effectiveFrom: "desc" },
  });
  const current = rows.find((r) => formatDate(r.effectiveFrom) <= day);
  return { inForce: current ? toScheduleDto(current) : toStandardDto(employeeId), history: rows.map(toScheduleDto) };
}

async function writeSchedule(prisma: PrismaClient, ctx: Ctx, employeeId: string, input: SetScheduleInput) {
  const calendarId = input.calendarId ?? null;
  // stored in ascending order so the same days in another order are the same schedule
  const workDays = [...input.workDays].sort((a, b) => a - b);
  const effectiveFrom = parseDate(input.effectiveFrom);

  return prisma.$transaction(async (tx) => {
    if (calendarId) {
      const calendar = await tx.holidayCalendar.findFirst({ where: { id: calendarId, companyId: ctx.companyId } });
      if (!calendar) throw new AppError(404, "NOT_FOUND", "calendar not found");
    }

    const existing = await tx.employeeWorkSchedule.findUnique({
      where: { companyId_employeeId_effectiveFrom: { companyId: ctx.companyId, employeeId, effectiveFrom } },
    });

    // the same values again change nothing, so they write no audit row either
    const unchanged =
      existing !== null &&
      new Decimal(existing.hoursPerDay.toString()).equals(input.hoursPerDay) &&
      existing.calendarId === calendarId &&
      existing.workDays.length === workDays.length &&
      existing.workDays.every((d, i) => d === workDays[i]);
    if (existing && unchanged) return toScheduleDto(existing);

    const values = { hoursPerDay: input.hoursPerDay, workDays, calendarId };
    const row = existing
      ? await tx.employeeWorkSchedule.update({ where: { id: existing.id }, data: values })
      : await tx.employeeWorkSchedule.create({
          data: { id: uuidv7(), companyId: ctx.companyId, employeeId, effectiveFrom, ...values },
        });

    // entity id is the schedule row, audit entity ids are uuids and an employee id is not
    await writeAudit(tx, ctx, {
      action: "WORK_SCHEDULE_SET",
      entityType: "work_schedule",
      entityId: row.id,
      before: existing ? toAuditValues(existing) : undefined,
      after: toAuditValues(row),
    });
    return toScheduleDto(row);
  });
}

// a lost race on the unique index is retried once, the second attempt sees the row and updates it
export async function setWorkSchedule(prisma: PrismaClient, ctx: Ctx, employeeId: string, input: SetScheduleInput) {
  try {
    return await writeSchedule(prisma, ctx, employeeId, input);
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    return await writeSchedule(prisma, ctx, employeeId, input);
  }
}

// loads what the pricing rule needs and prices the range, takes the transaction client so submit reads in its own transaction
export async function priceForEmployee(
  db: Prisma.TransactionClient,
  ctx: Ctx,
  employeeId: string,
  startDate: string,
  endDate: string,
) {
  // rows after the last day cannot apply to it, older rows decide the days before the first change
  const rows = await db.employeeWorkSchedule.findMany({
    where: { companyId: ctx.companyId, employeeId, effectiveFrom: { lte: parseDate(endDate) } },
  });
  const defaultCalendar = await db.holidayCalendar.findFirst({ where: { companyId: ctx.companyId, isDefault: true } });

  const schedules: ScheduleRow[] = rows.map((r) => ({
    effectiveFrom: formatDate(r.effectiveFrom),
    hoursPerDay: r.hoursPerDay.toFixed(4),
    workDays: r.workDays,
    calendarId: r.calendarId,
  }));

  // the holidays of every calendar a day in the range can use, inside the range only
  const calendarIds = new Set<string>();
  for (const s of schedules) if (s.calendarId) calendarIds.add(s.calendarId);
  if (defaultCalendar) calendarIds.add(defaultCalendar.id);

  const holidaysByCalendar = new Map<string, Map<string, string>>();
  if (calendarIds.size > 0) {
    const holidays = await db.holiday.findMany({
      where: { calendarId: { in: [...calendarIds] }, date: { gte: parseDate(startDate), lte: parseDate(endDate) } },
    });
    for (const h of holidays) {
      const dates = holidaysByCalendar.get(h.calendarId) ?? new Map<string, string>();
      dates.set(formatDate(h.date), h.name);
      holidaysByCalendar.set(h.calendarId, dates);
    }
  }

  return priceRange({
    startDate,
    endDate,
    schedules,
    holidaysByCalendar,
    defaultCalendarId: defaultCalendar?.id ?? null,
  });
}
