import { z } from "zod";

const isoDate = z.iso.date();
const hoursPerDay = z.string().regex(/^(?!0+(\.0+)?$)\d{1,2}(\.\d{1,4})?$/).refine((h) => Number(h) <= 24, {
  message: "hoursPerDay must be at most 24",
});

export const createCalendarBody = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional(),
});

export const setHolidaysBody = z
  .object({
    holidays: z.array(z.object({ date: isoDate, name: z.string().trim().min(1).max(100) })).min(1).max(100),
  })
  .refine((b) => new Set(b.holidays.map((h) => h.date)).size === b.holidays.length, {
    message: "dates must be unique",
  });

export const setWorkScheduleBody = z.object({
  effectiveFrom: isoDate,
  hoursPerDay,
  // iso weekdays, 1 is monday and 7 is sunday, no repeats
  workDays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((d) => new Set(d).size === d.length, { message: "workDays must not repeat" }),
  calendarId: z.guid().nullable().optional(),
});

export const previewQuery = z
  .object({ employeeId: z.string().min(1), startDate: isoDate, endDate: isoDate })
  .refine((q) => q.startDate <= q.endDate, { message: "startDate must not be after endDate" })
  .refine((q) => (Date.parse(q.endDate) - Date.parse(q.startDate)) / 86_400_000 < 366, {
    message: "a request spans at most 366 days",
  });
