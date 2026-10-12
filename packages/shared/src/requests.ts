import { z } from "zod";
import { timeOffTypes } from "./policy";

// positive hours, up to 4 decimals, zero is refused
const positiveHours = z.string().regex(/^(?!0+(\.0+)?$)\d+(\.\d{1,4})?$/);

export const requestStatuses = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

export const createRequestBody = z
  .object({
    employeeId: z.string().min(1),
    type: z.enum(timeOffTypes),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    hours: positiveHours,
    reason: z.string().trim().max(500).optional(),
    idempotencyKey: z.string().min(1).max(100),
  })
  .refine((b) => b.startDate <= b.endDate, { message: "startDate must not be after endDate" });

export const decisionBody = z.object({ reason: z.string().trim().max(500).optional() });
export const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

export const listRequestsQuery = z.object({
  status: z.enum(requestStatuses).optional(),
  employeeId: z.string().min(1).optional(),
});