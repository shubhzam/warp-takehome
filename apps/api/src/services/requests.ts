import { policyConfigSchema } from "@repo/shared/policy";
import type { createRequestBody, decisionBody, listRequestsQuery, rejectBody } from "@repo/shared/requests";
import type { previewQuery } from "@repo/shared/schedule";
import { Decimal } from "decimal.js";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import type { PrismaClient, TimeOffRequest } from "../generated/prisma/client";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate, todayUtc } from "../lib/dates";
import { AppError } from "../lib/errors";
import { lockBalance, postEntry } from "./ledger";
import { versionInForce } from "./policies";
import { priceForEmployee } from "./schedule";

type CreateInput = z.infer<typeof createRequestBody>;
type ListQuery = z.infer<typeof listRequestsQuery>;
type DecisionInput = z.infer<typeof decisionBody>;
type RejectInput = z.infer<typeof rejectBody>;
type PreviewQuery = z.infer<typeof previewQuery>;

export const toRequestDto = (r: TimeOffRequest) => ({
  id: r.id,
  employeeId: r.employeeId,
  policyId: r.policyId,
  type: r.type,
  startDate: formatDate(r.startDate),
  endDate: formatDate(r.endDate),
  hours: r.hours.toFixed(4),
  status: r.status,
  reason: r.reason,
  // how the hours were priced, null on requests made before schedules existed
  computation: r.computation,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  decisionReason: r.decisionReason,
  createdAt: r.createdAt.toISOString(),
});

// the exclusion constraint surfaces differently depending on the driver layer, so match on its name
function isOverlapError(err: unknown): boolean {
  return (
    err instanceof Error && (err.message.includes("requests_no_overlap") || err.message.includes("exclusion constraint"))
  );
}

function isUniqueError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// the stored request for an idempotency key, if there is one
const findByKey = (db: Prisma.TransactionClient, ctx: Ctx, idempotencyKey: string) =>
  db.timeOffRequest.findUnique({ where: { companyId_idempotencyKey: { companyId: ctx.companyId, idempotencyKey } } });

// the same key with the same content is the same request, anything else is a client bug
// when hours was omitted the stored total came from the schedule of that day, so only the shape is compared
function replayOf(existing: TimeOffRequest, input: CreateInput) {
  const sameShape =
    existing.employeeId === input.employeeId &&
    existing.type === input.type &&
    formatDate(existing.startDate) === input.startDate &&
    formatDate(existing.endDate) === input.endDate;
  const sameHours = input.hours === undefined || new Decimal(existing.hours.toString()).equals(new Decimal(input.hours));
  if (!sameShape || !sameHours) {
    throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "this key was already used for a different request");
  }
  return { request: toRequestDto(existing), replayed: true };
}

export async function createRequest(prisma: PrismaClient, ctx: Ctx, input: CreateInput) {
  // an employee can only ask for themselves
  if (ctx.role === "EMPLOYEE" && input.employeeId !== ctx.userId) {
    throw new AppError(403, "FORBIDDEN", "employees can only submit their own requests");
  }

  // a replay never reprices, a schedule or a holiday may have changed since the first submit
  const earlier = await findByKey(prisma, ctx, input.idempotencyKey);
  if (earlier) return replayOf(earlier, input);

  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);

  // the policy comes from the assignment that covers every day of the request
  const assignment = await prisma.assignment.findFirst({
    where: {
      companyId: ctx.companyId,
      employeeId: input.employeeId,
      type: input.type,
      effectiveFrom: { lte: start },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }],
    },
  });
  if (!assignment) {
    throw new AppError(422, "NOT_ASSIGNED", `no ${input.type} policy covers ${input.startDate} to ${input.endDate} for this employee`);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // priced inside the transaction, the breakdown stored with the request is the record of how the hours were reached
      const priced = await priceForEmployee(tx, ctx, input.employeeId, input.startDate, input.endDate);
      if (priced.hours.isZero()) {
        throw new AppError(422, "NO_WORKING_DAYS", `${input.startDate} to ${input.endDate} has no working day for ${input.employeeId}`);
      }

      // the schedule is the cap, a smaller number is a partial request
      const given = input.hours === undefined ? null : new Decimal(input.hours);
      if (given && given.gt(priced.hours)) {
        throw new AppError(
          422,
          "HOURS_TOO_LARGE",
          `${given.toFixed(4)} hours requested, the range holds ${priced.hours.toFixed(4)} hours of scheduled work`,
        );
      }
      const hours = given ?? priced.hours;

      const row = await tx.timeOffRequest.create({
        data: {
          id: uuidv7(),
          companyId: ctx.companyId,
          employeeId: input.employeeId,
          policyId: assignment.policyId,
          type: input.type,
          startDate: start,
          endDate: end,
          hours: hours.toFixed(4),
          status: "PENDING",
          reason: input.reason,
          computation: { source: given ? "GIVEN" : "COMPUTED", scheduledHours: priced.hours.toFixed(4), days: priced.days },
          idempotencyKey: input.idempotencyKey,
          createdBy: ctx.userId,
        },
      });
      await writeAudit(tx, ctx, {
        action: "REQUEST_CREATED",
        entityType: "request",
        entityId: row.id,
        after: {
          employeeId: input.employeeId,
          type: input.type,
          startDate: input.startDate,
          endDate: input.endDate,
          hours: hours.toFixed(4),
          status: "PENDING",
        },
        reason: input.reason,
      });
      return { request: toRequestDto(row), replayed: false };
    });
  } catch (err) {
    if (isUniqueError(err) || isOverlapError(err)) {
      // two first submits with one key race to the same rows, the loser finds the winner here
      const existing = await findByKey(prisma, ctx, input.idempotencyKey);
      if (existing) return replayOf(existing, input);
      if (isOverlapError(err)) {
        throw new AppError(409, "REQUEST_OVERLAP", "this employee already has a pending or approved request on those days");
      }
    }
    throw err;
  }
}

// the breakdown a submit would store, nothing is written
export async function previewRequest(prisma: PrismaClient, ctx: Ctx, query: PreviewQuery) {
  // an employee prices their own days, an admin may price anyone's
  if (ctx.role === "EMPLOYEE" && query.employeeId !== ctx.userId) {
    throw new AppError(403, "FORBIDDEN", "employees can only preview their own requests");
  }
  const priced = await priceForEmployee(prisma, ctx, query.employeeId, query.startDate, query.endDate);
  return {
    employeeId: query.employeeId,
    startDate: query.startDate,
    endDate: query.endDate,
    hours: priced.hours.toFixed(4),
    days: priced.days,
  };
}

export async function listRequests(prisma: PrismaClient, ctx: Ctx, query: ListQuery) {
  // an employee only ever sees their own requests
  const employeeId = ctx.role === "EMPLOYEE" ? ctx.userId : query.employeeId;
  const rows = await prisma.timeOffRequest.findMany({
    where: {
      companyId: ctx.companyId,
      ...(employeeId ? { employeeId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRequestDto);
}

export async function getRequest(prisma: PrismaClient, ctx: Ctx, id: string) {
  const row = await prisma.timeOffRequest.findFirst({
    where: { id, companyId: ctx.companyId, ...(ctx.role === "EMPLOYEE" ? { employeeId: ctx.userId } : {}) },
  });
  // another employee's request looks the same as a missing one
  if (!row) throw new AppError(404, "NOT_FOUND", "request not found");
  return toRequestDto(row);
}

// takes the row lock first, so two decisions on one request take turns
// the row is read after the lock, so it shows what the winner left behind
async function lockRequest(tx: Prisma.TransactionClient, ctx: Ctx, id: string): Promise<TimeOffRequest> {
  await tx.$queryRaw`SELECT 1 FROM time_off_requests WHERE id = ${id}::uuid AND company_id = ${ctx.companyId}::uuid FOR UPDATE`;
  const row = await tx.timeOffRequest.findFirst({ where: { id, companyId: ctx.companyId } });
  // another employee's request looks the same as a missing one
  if (!row || (ctx.role === "EMPLOYEE" && row.employeeId !== ctx.userId)) {
    throw new AppError(404, "NOT_FOUND", "request not found");
  }
  return row;
}

export async function approveRequest(prisma: PrismaClient, ctx: Ctx, id: string, input: DecisionInput) {
  return prisma.$transaction(async (tx) => {
    const row = await lockRequest(tx, ctx, id);
    // approving twice is a no-op, any other state is a real conflict
    if (row.status === "APPROVED") return toRequestDto(row);
    if (row.status !== "PENDING") {
      throw new AppError(409, "INVALID_TRANSITION", `a ${row.status.toLowerCase()} request cannot be approved`);
    }

    // the rules that apply are the ones in force on the first day of the leave
    const startDate = formatDate(row.startDate);
    const version = await versionInForce(tx, row.policyId, startDate);
    if (!version) throw new AppError(422, "NO_POLICY_VERSION", `the policy has no version in force on ${startDate}`);
    const config = policyConfigSchema.parse(version.config);

    // unlimited policies have no balance, so approving only changes the status
    const spends = config.accrual.kind !== "UNLIMITED";
    if (spends) {
      const hours = new Decimal(row.hours.toString());
      // lock first, read after: the second approval waits here and sees the balance the first one left
      const balance = await lockBalance(tx, ctx.companyId, row.employeeId, row.policyId);
      const floor = new Decimal(config.maxNegativeHours ?? "0").negated();
      if (balance.minus(hours).lt(floor)) {
        throw new AppError(
          422,
          "INSUFFICIENT_BALANCE",
          `approving needs ${hours.toFixed(4)} hours, available ${balance.minus(floor).toFixed(4)}`,
        );
      }
      await postEntry(tx, {
        companyId: ctx.companyId,
        employeeId: row.employeeId,
        policyId: row.policyId,
        kind: "TIME_OFF",
        hours: hours.negated(),
        occurredOn: startDate,
        period: null,
        idempotencyKey: `request:${row.id}:debit`,
        detail: { requestId: row.id },
        reason: row.reason,
        createdBy: ctx.userId,
      });
    }

    const updated = await tx.timeOffRequest.update({
      where: { id: row.id },
      data: { status: "APPROVED", decidedBy: ctx.userId, decidedAt: new Date(), decisionReason: input.reason },
    });
    await writeAudit(tx, ctx, {
      action: "REQUEST_APPROVED",
      entityType: "request",
      entityId: row.id,
      before: { status: "PENDING" },
      after: { status: "APPROVED", ledgerKey: spends ? `request:${row.id}:debit` : null },
      reason: input.reason,
    });
    return toRequestDto(updated);
  });
}

export async function rejectRequest(prisma: PrismaClient, ctx: Ctx, id: string, input: RejectInput) {
  return prisma.$transaction(async (tx) => {
    const row = await lockRequest(tx, ctx, id);
    if (row.status === "REJECTED") return toRequestDto(row);
    if (row.status !== "PENDING") {
      throw new AppError(409, "INVALID_TRANSITION", `a ${row.status.toLowerCase()} request cannot be rejected`);
    }
    const updated = await tx.timeOffRequest.update({
      where: { id: row.id },
      data: { status: "REJECTED", decidedBy: ctx.userId, decidedAt: new Date(), decisionReason: input.reason },
    });
    await writeAudit(tx, ctx, {
      action: "REQUEST_REJECTED",
      entityType: "request",
      entityId: row.id,
      before: { status: "PENDING" },
      after: { status: "REJECTED" },
      reason: input.reason,
    });
    return toRequestDto(updated);
  });
}

export async function cancelRequest(prisma: PrismaClient, ctx: Ctx, id: string, input: DecisionInput) {
  return prisma.$transaction(async (tx) => {
    const row = await lockRequest(tx, ctx, id);
    if (row.status === "CANCELLED") return toRequestDto(row);
    if (row.status === "REJECTED") {
      throw new AppError(409, "INVALID_TRANSITION", "a rejected request cannot be cancelled");
    }

    let creditKey: string | null = null;
    if (row.status === "APPROVED") {
      // once the leave has started it is history, fix it with an admin adjustment
      if (formatDate(row.startDate) <= todayUtc()) {
        throw new AppError(422, "TOO_LATE_TO_CANCEL", "this request has already started, ask an admin for an adjustment");
      }
      // give back exactly what was taken, unlimited policies took nothing so there is no debit to find
      const debit = await tx.ledgerEntry.findUnique({
        where: { companyId_idempotencyKey: { companyId: ctx.companyId, idempotencyKey: `request:${row.id}:debit` } },
      });
      if (debit) {
        creditKey = `request:${row.id}:credit`;
        // the balance row lock is taken by the update inside postEntry
        await postEntry(tx, {
          companyId: ctx.companyId,
          employeeId: row.employeeId,
          policyId: row.policyId,
          kind: "TIME_OFF_REVERSAL",
          hours: new Decimal(debit.hours.toString()).negated(),
          occurredOn: todayUtc(),
          period: null,
          idempotencyKey: creditKey,
          detail: { requestId: row.id },
          reason: input.reason ?? null,
          createdBy: ctx.userId,
        });
      }
    }

    const updated = await tx.timeOffRequest.update({
      where: { id: row.id },
      data: { status: "CANCELLED", decidedBy: ctx.userId, decidedAt: new Date(), decisionReason: input.reason },
    });
    await writeAudit(tx, ctx, {
      action: "REQUEST_CANCELLED",
      entityType: "request",
      entityId: row.id,
      before: { status: row.status },
      after: { status: "CANCELLED", ledgerKey: creditKey },
      reason: input.reason,
    });
    return toRequestDto(updated);
  });
}