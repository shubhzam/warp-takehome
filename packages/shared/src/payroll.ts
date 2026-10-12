import { z } from "zod";

// hours worked are never negative, up to 4 decimals, zero is allowed and simply earns nothing
const hoursWorked = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const payrollAccrualBody = z
  .object({
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    entries: z.array(z.object({ employeeId: z.string().min(1), hoursWorked })).min(1).max(500),
  })
  .refine((b) => b.periodStart <= b.periodEnd, { message: "periodStart must not be after periodEnd" })
  // a pay period is a few weeks, anything longer is a typo
  .refine((b) => (Date.parse(b.periodEnd) - Date.parse(b.periodStart)) / 86_400_000 < 62, {
    message: "a pay period is at most 62 days",
  })
  .refine((b) => new Set(b.entries.map((e) => e.employeeId)).size === b.entries.length, {
    message: "employeeIds must be unique",
  });