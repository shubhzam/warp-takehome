import { policyConfigSchema } from "@repo/shared/policy";
import type { yearEndBody } from "@repo/shared/year-end";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { parseDate, todayUtc } from "../lib/dates";
import { AppError } from "../lib/errors";
import { lockBalance, postEntry } from "./ledger";

type YearEndInput = z.infer<typeof yearEndBody>;

type Group = { employeeId: string; policyId: string; hours: string };

// the cap of each policy comes from the version in force on december 31, policies without a carryover rule are left out
async function capsAsOf(prisma: PrismaClient, ctx: Ctx, lastDay: string): Promise<Map<string, Decimal>> {
  const policies = await prisma.policy.findMany({ where: { companyId: ctx.companyId }, select: { id: true } });
  const versions = await prisma.policyVersion.findMany({
    where: { policyId: { in: policies.map((p) => p.id) }, effectiveFrom: { lte: parseDate(lastDay) } },
  });

  // latest start wins, the higher version_no breaks a tie, same as everywhere else
  const inForce = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    const current = inForce.get(v.policyId);
    const newer =
      !current ||
      v.effectiveFrom.getTime() > current.effectiveFrom.getTime() ||
      (v.effectiveFrom.getTime() === current.effectiveFrom.getTime() && v.versionNo > current.versionNo);
    if (newer) inForce.set(v.policyId, v);
  }

  const caps = new Map<string, Decimal>();
  for (const [policyId, row] of inForce) {
    const config = policyConfigSchema.parse(row.config);
    if (config.carryover) caps.set(policyId, new Decimal(config.carryover.maxHours));
  }
  return caps;
}

export async function runYearEnd(prisma: PrismaClient, ctx: Ctx, input: YearEndInput) {
  const year = String(input.year);
  const lastDay = `${year}-12-31`;

  // the year has to be over, january 1st of the next year must be today or earlier
  if (`${input.year + 1}-01-01` > todayUtc()) {
    throw new AppError(422, "YEAR_NOT_ENDED", `${year} ends on ${lastDay}`);
  }

  const caps = await capsAsOf(prisma, ctx, lastDay);

  let created = 0;
  let alreadyExpired = 0;
  let skipped = 0;

  if (caps.size > 0) {
    // balance per employee as of december 31, leaving out this year's own expiry entries
    // that way a rerun sees the same balance the first run saw
    const groups = await prisma.$queryRaw<Group[]>`
      SELECT employee_id AS "employeeId", policy_id::text AS "policyId", SUM(hours)::text AS hours
      FROM ledger_entries
      WHERE company_id = ${ctx.companyId}::uuid
        AND policy_id = ANY(${[...caps.keys()]}::uuid[])
        AND occurred_on <= ${lastDay}::date
        AND (kind <> 'EXPIRATION' OR COALESCE(period, '') <> ${year}::text)
      GROUP BY employee_id, policy_id`;

    for (const g of groups) {
      const cap = caps.get(g.policyId);
      if (!cap || new Decimal(g.hours).lte(cap)) {
        skipped += 1;
        continue;
      }

      // one small transaction per employee, the balance lock is taken first and the sum is read again under it
      // so a request approved while the run is going is either counted or waits
      const outcome = await prisma.$transaction(async (tx) => {
        await lockBalance(tx, ctx.companyId, g.employeeId, g.policyId);
        const [row] = await tx.$queryRaw<{ hours: string | null }[]>`
          SELECT SUM(hours)::text AS hours
          FROM ledger_entries
          WHERE company_id = ${ctx.companyId}::uuid
            AND employee_id = ${g.employeeId}
            AND policy_id = ${g.policyId}::uuid
            AND occurred_on <= ${lastDay}::date
            AND (kind <> 'EXPIRATION' OR COALESCE(period, '') <> ${year}::text)`;
        const balance = new Decimal(row?.hours ?? "0");
        if (balance.lte(cap)) return "skipped" as const;

        const inserted = await postEntry(tx, {
          companyId: ctx.companyId,
          employeeId: g.employeeId,
          policyId: g.policyId,
          kind: "EXPIRATION",
          hours: balance.minus(cap).negated(),
          occurredOn: lastDay,
          period: year,
          idempotencyKey: `expiry:${g.employeeId}:${g.policyId}:${year}`,
          detail: { year: input.year, balanceAtYearEnd: balance.toFixed(4), cap: cap.toFixed(4) },
          reason: "year end carryover cap",
          createdBy: ctx.userId,
        });
        return inserted ? ("created" as const) : ("alreadyExpired" as const);
      });

      if (outcome === "created") created += 1;
      else if (outcome === "alreadyExpired") alreadyExpired += 1;
      else skipped += 1;
    }
  }

  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx, {
      action: "YEAR_END_RUN",
      entityType: "company",
      entityId: ctx.companyId,
      after: { year: input.year, created, alreadyExpired, skipped },
    }),
  );
  return { year: input.year, created, alreadyExpired, skipped };
}