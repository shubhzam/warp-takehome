import { z } from "zod";

// signed hours, up to 4 decimals, never zero
const signedHours = z.string().regex(/^-?(?!0+(\.0+)?$)\d+(\.\d{1,4})?$/);

export const accrualRunBody = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export const adjustmentKinds = ["ADJUSTMENT", "OPENING_BALANCE"] as const;

export const adjustmentBody = z.object({
  employeeId: z.string().min(1),
  policyId: z.guid(),
  kind: z.enum(adjustmentKinds),
  hours: signedHours,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(1).max(100),
});