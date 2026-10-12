import { uuidv7 } from "uuidv7";
import type { Prisma } from "../generated/prisma/client";
import type { Ctx } from "./auth";

export type AuditInput = {
  action: "POLICY_CREATED" | "POLICY_VERSION_CREATED" | "ASSIGNMENT_CREATED" | "ASSIGNMENT_ENDED" | "ACCRUAL_RUN" | "ADJUSTMENT_CREATED" | "REQUEST_CREATED" | "REQUEST_APPROVED" | "REQUEST_REJECTED" | "REQUEST_CANCELLED" | "PAYROLL_ACCRUAL_RUN";
  // a new version is recorded against its policy, so one policy's whole history is one query
  entityType: "policy" | "assignment" | "company" | "ledger_entry" | "request";
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
};

// takes the transaction client so the audit row commits or rolls back together with the change it describes
export async function writeAudit(tx: Prisma.TransactionClient, ctx: Ctx, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      id: uuidv7(),
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorRole: ctx.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      reason: input.reason,
    },
  });
}