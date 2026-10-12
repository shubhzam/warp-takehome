import type { payrollAccrualBody } from "@repo/shared/payroll";
import { policyConfigSchema } from "@repo/shared/policy";
import { Decimal } from "decimal.js";
import { z } from "zod";
import type { Assignment, PrismaClient } from "../generated/prisma/client";
import { type AccrualVersion, computeWorkedAccrual } from "../lib/accrual";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate, todayUtc } from "../lib/dates";
import { AppError } from "../lib/errors";
import { postEntry } from "./ledger";

type PayrollInput = z.infer<typeof payrollAccrualBody>;

type Mismatch = {
  employeeId: string;
  policyId: string;
  accruedHoursWorked: string;
  receivedHoursWorked: string;
};

// what a payroll entry stores in its detail, read back to compare hours on a resend
const storedDetail = z.object({ hoursWorked: z.string() });

export async function runPayrollAccrual(prisma: PrismaClient, ctx: Ctx, input: PayrollInput) {
  // the pay period has to be over, the day after its last day must be today or earlier
  const dayAfter = formatDate(new Date(parseDate(input.periodEnd).getTime() + 86_400_000));
  if (dayAfter > todayUtc()) {
    throw new AppError(422, "PERIOD_NOT_ENDED", `${input.periodEnd} has not finished`);
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      companyId: ctx.companyId,
      employeeId: { in: input.entries.map((e) => e.employeeId) },
      effectiveFrom: { lt: parseDate(dayAfter) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseDate(input.periodStart) } }],
    },
  });

  // per employee and type, the latest assignment that touches the period gets all the hours
  const latest = new Map<string, Assignment>();
  for (const a of assignments) {
    const key = `${a.employeeId}:${a.type}`;
    const current = latest.get(key);
    if (!current || a.effectiveFrom.getTime() > current.effectiveFrom.getTime()) latest.set(key, a);
  }
  const picksByEmployee = new Map<string, Assignment[]>();
  for (const a of latest.values()) {
    const list = picksByEmployee.get(a.employeeId) ?? [];
    list.push(a);
    picksByEmployee.set(a.employeeId, list);
  }

  const policyIds = [...new Set([...latest.values()].map((a) => a.policyId))];
  const versionRows = await prisma.policyVersion.findMany({
    where: { policyId: { in: policyIds }, effectiveFrom: { lt: parseDate(dayAfter) } },
  });
  const versionsByPolicy = new Map<string, AccrualVersion[]>();
  for (const row of versionRows) {
    const list = versionsByPolicy.get(row.policyId) ?? [];
    list.push({
      versionNo: row.versionNo,
      effectiveFrom: formatDate(row.effectiveFrom),
      config: policyConfigSchema.parse(row.config),
    });
    versionsByPolicy.set(row.policyId, list);
  }

  let created = 0;
  let alreadyAccrued = 0;
  let skipped = 0;
  const mismatched: Mismatch[] = [];

  for (const entry of input.entries) {
    const picks = picksByEmployee.get(entry.employeeId) ?? [];
    if (picks.length === 0) {
      skipped += 1;
      continue;
    }
    for (const a of picks) {
      const result = computeWorkedAccrual({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        hoursWorked: entry.hoursWorked,
        assignmentFrom: formatDate(a.effectiveFrom),
        assignmentTo: a.effectiveTo ? formatDate(a.effectiveTo) : null,
        versions: versionsByPolicy.get(a.policyId) ?? [],
      });
      // time based and unlimited policies earn nothing here, so do zero hours
      if (result.hours.isZero()) {
        skipped += 1;
        continue;
      }

      const idempotencyKey = `payroll:${a.employeeId}:${a.policyId}:${input.periodStart}:${input.periodEnd}`;
      // one small transaction per entry, a crash halfway loses nothing because a resend posts only the missing ones
      const inserted = await prisma.$transaction((tx) =>
        postEntry(tx, {
          companyId: ctx.companyId,
          employeeId: a.employeeId,
          policyId: a.policyId,
          kind: "ACCRUAL",
          hours: result.hours,
          occurredOn: input.periodEnd,
          period: `${input.periodStart}/${input.periodEnd}`,
          idempotencyKey,
          detail: result.detail,
          reason: null,
          createdBy: ctx.userId,
        }),
      );
      if (inserted) {
        created += 1;
        continue;
      }

      // the key was used before: same hours is a plain resend, other hours is a correction we never apply
      const existing = await prisma.ledgerEntry.findUnique({
        where: { companyId_idempotencyKey: { companyId: ctx.companyId, idempotencyKey } },
      });
      const stored = storedDetail.safeParse(existing?.detail);
      if (stored.success && new Decimal(stored.data.hoursWorked).equals(new Decimal(entry.hoursWorked))) {
        alreadyAccrued += 1;
      } else {
        mismatched.push({
          employeeId: a.employeeId,
          policyId: a.policyId,
          accruedHoursWorked: stored.success ? stored.data.hoursWorked : "unknown",
          receivedHoursWorked: entry.hoursWorked,
        });
      }
    }
  }

  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx, {
      action: "PAYROLL_ACCRUAL_RUN",
      entityType: "company",
      entityId: ctx.companyId,
      after: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        created,
        alreadyAccrued,
        skipped,
        mismatched: mismatched.length,
      },
    }),
  );
  return { periodStart: input.periodStart, periodEnd: input.periodEnd, created, alreadyAccrued, skipped, mismatched };
}