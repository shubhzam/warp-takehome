import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import type { assignBody, endAssignmentBody } from "@repo/shared/policy";
import type { Assignment, PrismaClient } from "../generated/prisma/client";
import type { Ctx } from "../lib/auth";
import { writeAudit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { formatDate, parseDate, todayUtc } from "../lib/dates";

type AssignInput = z.infer<typeof assignBody>;
type EndInput = z.infer<typeof endAssignmentBody>;

const toAssignmentDto = (a: Assignment) => ({
  id: a.id,
  employeeId: a.employeeId,
  policyId: a.policyId,
  type: a.type,
  effectiveFrom: formatDate(a.effectiveFrom),
  effectiveTo: a.effectiveTo ? formatDate(a.effectiveTo) : null,
});

// the exclusion constraint surfaces differently depending on the driver layer, so match on its name
function isOverlapError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("assignments_no_overlap") || err.message.includes("exclusion constraint"))
  );
}

export async function assignEmployees(prisma: PrismaClient, ctx: Ctx, policyId: string, input: AssignInput) {
  try {
    // one transaction for the whole group, either everyone is assigned or nobody is
    return await prisma.$transaction(
      async (tx) => {
        const policy = await tx.policy.findFirst({ where: { id: policyId, companyId: ctx.companyId } });
        if (!policy) throw new AppError(404, "NOT_FOUND", "policy not found");

        // an assignment before the policy's first version would have no rules to follow
        const first = await tx.policyVersion.aggregate({ where: { policyId }, _min: { effectiveFrom: true } });
        const firstDate = first._min.effectiveFrom ? formatDate(first._min.effectiveFrom) : null;
        if (firstDate && input.effectiveFrom < firstDate) {
          throw new AppError(422, "EFFECTIVE_BEFORE_POLICY_START", `this policy starts on ${firstDate}`);
        }

        // the exclusion constraint rejects the insert if anyone already has this type in the range
        const rows = await tx.assignment.createManyAndReturn({
          data: input.employeeIds.map((employeeId) => ({
            id: uuidv7(),
            companyId: ctx.companyId,
            employeeId,
            policyId,
            type: policy.type,
            effectiveFrom: parseDate(input.effectiveFrom),
          })),
        });

        for (const row of rows) {
          await writeAudit(tx, ctx, {
            action: "ASSIGNMENT_CREATED",
            entityType: "assignment",
            entityId: row.id,
            after: { employeeId: row.employeeId, policyId, effectiveFrom: input.effectiveFrom, effectiveTo: null },
          });
        }
        return { assignments: rows.map(toAssignmentDto) };
      },
      { timeout: 10_000 },
    );
  } catch (err) {
    if (isOverlapError(err)) {
      throw new AppError(409, "ASSIGNMENT_OVERLAP", "one or more employees already have a policy of this type in that date range");
    }
    throw err;
  }
}

export async function listEmployeeAssignments(prisma: PrismaClient, ctx: Ctx, employeeId: string) {
  const rows = await prisma.assignment.findMany({
    where: { companyId: ctx.companyId, employeeId },
    orderBy: { effectiveFrom: "asc" },
  });
  return rows.map(toAssignmentDto);
}

// every assignment of one policy, ended ones included, newest start first
export async function listPolicyAssignments(prisma: PrismaClient, ctx: Ctx, policyId: string) {
  const policy = await prisma.policy.findFirst({ where: { id: policyId, companyId: ctx.companyId } });
  if (!policy) throw new AppError(404, "NOT_FOUND", "policy not found");
  const rows = await prisma.assignment.findMany({
    where: { companyId: ctx.companyId, policyId },
    orderBy: [{ effectiveFrom: "desc" }, { employeeId: "asc" }],
  });
  return { assignments: rows.map(toAssignmentDto) };
}

export async function endAssignment(prisma: PrismaClient, ctx: Ctx, assignmentId: string, input: EndInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.assignment.findFirst({ where: { id: assignmentId, companyId: ctx.companyId } });
      if (!current) throw new AppError(404, "NOT_FOUND", "assignment not found");

      const oldEnd = current.effectiveTo ? formatDate(current.effectiveTo) : null;
      // setting the value it already has is a no-op, no write and no audit row
      if (oldEnd === input.effectiveTo) return toAssignmentDto(current);

      // the end must come after the start and cannot rewrite the past
      if (input.effectiveTo <= formatDate(current.effectiveFrom) || input.effectiveTo < todayUtc()) {
        throw new AppError(422, "INVALID_END_DATE", "end date must be after the start date and not in the past");
      }

      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data: { effectiveTo: parseDate(input.effectiveTo) },
      });
      await writeAudit(tx, ctx, {
        action: "ASSIGNMENT_ENDED",
        entityType: "assignment",
        entityId: assignmentId,
        before: { effectiveTo: oldEnd },
        after: { effectiveTo: input.effectiveTo },
      });
      return toAssignmentDto(updated);
    });
  } catch (err) {
    // extending an end date can run into the next assignment, same constraint, same answer
    if (isOverlapError(err)) {
      throw new AppError(409, "ASSIGNMENT_OVERLAP", "that end date overlaps another assignment of this type");
    }
    throw err;
  }
}