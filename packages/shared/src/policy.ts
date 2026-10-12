import { z } from "zod";

// amounts are decimal strings with up to 4 decimals, never js numbers
const decimal = z.string().regex(/^\d+(\.\d{1,4})?$/);

// same shape but must be above zero, used where zero would break accrual math
const positiveDecimal = z.string().regex(/^(?!0+(\.0+)?$)\d+(\.\d{1,4})?$/);

const isoDate = z.iso.date();

export const timeOffTypes = ["VACATION", "SICK", "PARENTAL"] as const;
export type TimeOffType = (typeof timeOffTypes)[number];

// a tier raises the monthly rate once the employee has this many whole years of service
const tier = z
  .object({ afterYears: z.number().int().min(1).max(60), hoursPerMonth: positiveDecimal })
  .strict();

// strictly ascending, so the rate for a given tenure is never ambiguous
const tiers = z
  .array(tier)
  .max(10)
  .refine((t) => t.every((x, i) => i === 0 || x.afterYears > (t[i - 1]?.afterYears ?? 0)), {
    message: "tiers must have strictly ascending afterYears",
  });

// strict so a key on the wrong kind (tiers on hours worked) is an error, not silently dropped
const accrual = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("UNLIMITED") }).strict(),
  z.object({ kind: z.literal("TIME"), hoursPerMonth: positiveDecimal, tiers: tiers.optional() }).strict(),
  z
    .object({
      kind: z.literal("HOURS_WORKED"),
      earnHours: positiveDecimal,
      perHoursWorked: positiveDecimal,
    })
    .strict(),
]);

// maxHours is the most that carries into the next year, zero is allowed and expires everything
const carryover = z.object({ maxHours: decimal }).strict();

// maxNegativeHours is how far below zero the balance may go, absent means 0
export const policyConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    accrual,
    maxNegativeHours: decimal.optional(),
    carryover: carryover.optional(),
  })
  .strict()
  .refine((c) => !(c.accrual.kind === "UNLIMITED" && c.maxNegativeHours !== undefined), {
    message: "maxNegativeHours is not allowed on an unlimited policy",
  })
  .refine((c) => !(c.accrual.kind === "UNLIMITED" && c.carryover !== undefined), {
    message: "carryover is not allowed on an unlimited policy",
  });
export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export const createPolicyBody = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(timeOffTypes),
  effectiveFrom: isoDate,
  config: policyConfigSchema,
  reason: z.string().trim().max(500).optional(),
});

export const createVersionBody = z.object({
  effectiveFrom: isoDate,
  config: policyConfigSchema,
  reason: z.string().trim().min(1).max(500),
});

export const assignBody = z
  .object({
    employeeIds: z.array(z.string().min(1)).min(1).max(500),
    effectiveFrom: isoDate,
  })
  .refine((b) => new Set(b.employeeIds).size === b.employeeIds.length, {
    message: "employeeIds must be unique",
  });

export const endAssignmentBody = z.object({ effectiveTo: isoDate });