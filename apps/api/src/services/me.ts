import { policyConfigSchema } from "@repo/shared/policy";
import type { PrismaClient } from "../generated/prisma/client";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate, todayUtc } from "../lib/dates";
import { versionInForce } from "./policies";

// the assignments an employee has today, with how each policy accrues
export async function listMyAssignments(prisma: PrismaClient, ctx: Ctx) {
  const today = todayUtc();
  // effectiveTo is exclusive, an assignment ending today is already over
  const rows = await prisma.assignment.findMany({
    where: {
      companyId: ctx.companyId,
      employeeId: ctx.userId,
      effectiveFrom: { lte: parseDate(today) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseDate(today) } }],
    },
    include: { policy: true },
    // uuidv7 ids sort by creation time, so ties keep the order they were assigned
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
  });

  const assignments = [];
  for (const a of rows) {
    const version = await versionInForce(prisma, a.policyId, today);
    // assign refuses dates before the first version, so this only skips rows written outside the api
    if (!version) continue;
    assignments.push({
      policyId: a.policyId,
      policyName: a.policy.name,
      type: a.type,
      accrual: policyConfigSchema.parse(version.config).accrual.kind,
      effectiveFrom: formatDate(a.effectiveFrom),
      effectiveTo: a.effectiveTo ? formatDate(a.effectiveTo) : null,
    });
  }
  return { assignments };
}
