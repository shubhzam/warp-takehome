import type { adjustmentBody } from "@repo/shared/ledger";
import { policyConfigSchema } from "@repo/shared/policy";
import { Decimal } from "decimal.js";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import type { LedgerEntry, Prisma, PrismaClient } from "../generated/prisma/client";
import { type AccrualDetail, type AccrualVersion, computeAccrual, periodBounds } from "../lib/accrual";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate, todayUtc } from "../lib/dates";
import { AppError } from "../lib/errors";

type AdjustmentInput = z.infer<typeof adjustmentBody>;

type NewEntry = {
  companyId: string;
  employeeId: string;
  policyId: string;
  kind: string;
  hours: Decimal;
  occurredOn: string;
  period: string | null;
  idempotencyKey: string;
  detail: Prisma.InputJsonValue | null;
  reason: string | null;
  createdBy: string;
};

const toEntryDto = (e: LedgerEntry) => ({
  id: e.id,
  employeeId: e.employeeId,
  policyId: e.policyId,
  kind: e.kind,
  hours: e.hours.toFixed(4),
  occurredOn: formatDate(e.occurredOn),
  period: e.period,
  detail: e.detail,
  reason: e.reason,
  createdBy: e.createdBy,
  createdAt: e.createdAt.toISOString(),
});

// the only way hours enter the ledger, returns false when the idempotency key was already used
// the balance update only runs if the insert really happened, so a repeat can never add hours twice
export async function postEntry(tx: Prisma.TransactionClient, e: NewEntry): Promise<boolean> {
  await tx.$executeRaw`
    INSERT INTO balances (employee_id, policy_id, company_id, hours)
    VALUES (${e.employeeId}, ${e.policyId}::uuid, ${e.companyId}::uuid, 0)
    ON CONFLICT (employee_id, policy_id) DO NOTHING`;

  const detailJson = e.detail === null ? null : JSON.stringify(e.detail);
  const rows = await tx.$queryRaw<{ inserted: bigint }[]>`
    WITH ins AS (
      INSERT INTO ledger_entries (id, company_id, employee_id, policy_id, kind, hours, occurred_on, period, idempotency_key, detail, reason, created_by)
      VALUES (${uuidv7()}::uuid, ${e.companyId}::uuid, ${e.employeeId}, ${e.policyId}::uuid, ${e.kind}, ${e.hours.toFixed(4)}::numeric,
              ${e.occurredOn}::date, ${e.period}, ${e.idempotencyKey}, ${detailJson}::jsonb, ${e.reason}, ${e.createdBy})
      ON CONFLICT (company_id, idempotency_key) DO NOTHING
      RETURNING hours
    ), upd AS (
      UPDATE balances SET hours = hours + (SELECT hours FROM ins), updated_at = now()
      WHERE employee_id = ${e.employeeId} AND policy_id = ${e.policyId}::uuid AND EXISTS (SELECT 1 FROM ins)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ins) AS inserted`;
  return Number(rows[0]?.inserted ?? 0) === 1;
}

// locks the balance row until the transaction ends and returns what it holds
// the row is created with 0 first, so an employee who was never accrued can still be locked
export async function lockBalance(
  tx: Prisma.TransactionClient,
  companyId: string,
  employeeId: string,
  policyId: string,
): Promise<Decimal> {
  await tx.$executeRaw`
    INSERT INTO balances (employee_id, policy_id, company_id, hours)
    VALUES (${employeeId}, ${policyId}::uuid, ${companyId}::uuid, 0)
    ON CONFLICT (employee_id, policy_id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ hours: string }[]>`
    SELECT hours::text AS hours FROM balances
    WHERE employee_id = ${employeeId} AND policy_id = ${policyId}::uuid
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error("balance row missing after insert");
  return new Decimal(row.hours);
}

export async function runAccrual(prisma: PrismaClient, ctx: Ctx, period: string) {
  const bounds = periodBounds(period);
  // hours are earned in arrears, so the period has to be over
  if (bounds.endExclusive > todayUtc()) {
    throw new AppError(422, "PERIOD_NOT_ENDED", `${period} ends on ${bounds.lastDay}`);
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      companyId: ctx.companyId,
      effectiveFrom: { lt: parseDate(bounds.endExclusive) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: parseDate(bounds.start) } }],
    },
  });

  // recorded start dates for tenure tiers, one query for the whole run
  const startRows = await prisma.employeeStartDate.findMany({
    where: { companyId: ctx.companyId, employeeId: { in: [...new Set(assignments.map((a) => a.employeeId))] } },
  });
  const startDates = new Map<string, string>(
    startRows.map((r): [string, string] => [r.employeeId, formatDate(r.startDate)]),
  );

  const policyIds = [...new Set(assignments.map((a) => a.policyId))];
  const versionRows = await prisma.policyVersion.findMany({
    where: { policyId: { in: policyIds }, effectiveFrom: { lt: parseDate(bounds.endExclusive) } },
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

  // one entry per employee and policy, an employee re-assigned to the same policy mid period adds up into one entry
  // each span is rounded before adding, which can differ from one rounding by 0.0001 in that rare case
  const totals = new Map<string, { employeeId: string; policyId: string; hours: Decimal; segments: AccrualDetail["segments"] }>();
  for (const a of assignments) {
    const result = computeAccrual({
      period,
      assignmentFrom: formatDate(a.effectiveFrom),
      assignmentTo: a.effectiveTo ? formatDate(a.effectiveTo) : null,
      versions: versionsByPolicy.get(a.policyId) ?? [],
      startDate: startDates.get(a.employeeId) ?? null,
    });
    const key = `${a.employeeId}:${a.policyId}`;
    const total = totals.get(key) ?? { employeeId: a.employeeId, policyId: a.policyId, hours: new Decimal(0), segments: [] };
    total.hours = total.hours.plus(result.hours);
    total.segments.push(...result.detail.segments);
    totals.set(key, total);
  }

  let created = 0;
  let alreadyAccrued = 0;
  let skipped = 0;
  for (const t of totals.values()) {
    if (t.hours.isZero()) {
      skipped += 1;
      continue;
    }
    // one small transaction per entry, a crash halfway loses nothing because a rerun posts only the missing ones
    const inserted = await prisma.$transaction((tx) =>
      postEntry(tx, {
        companyId: ctx.companyId,
        employeeId: t.employeeId,
        policyId: t.policyId,
        kind: "ACCRUAL",
        hours: t.hours,
        occurredOn: bounds.lastDay,
        period,
        idempotencyKey: `accrual:${t.employeeId}:${t.policyId}:${period}`,
        detail: { daysInPeriod: bounds.days, segments: t.segments },
        reason: null,
        createdBy: ctx.userId,
      }),
    );
    if (inserted) created += 1;
    else alreadyAccrued += 1;
  }

  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx, {
      action: "ACCRUAL_RUN",
      entityType: "company",
      entityId: ctx.companyId,
      after: { period, created, alreadyAccrued, skipped },
    }),
  );
  return { period, created, alreadyAccrued, skipped };
}

export async function createAdjustment(prisma: PrismaClient, ctx: Ctx, input: AdjustmentInput) {
  const policy = await prisma.policy.findFirst({ where: { id: input.policyId, companyId: ctx.companyId } });
  if (!policy) throw new AppError(404, "NOT_FOUND", "policy not found");
  const assigned = await prisma.assignment.findFirst({
    where: { companyId: ctx.companyId, employeeId: input.employeeId, policyId: input.policyId },
  });
  if (!assigned) throw new AppError(422, "NOT_ASSIGNED", "this employee has never been assigned to this policy");

  return prisma.$transaction(async (tx) => {
    const inserted = await postEntry(tx, {
      companyId: ctx.companyId,
      employeeId: input.employeeId,
      policyId: input.policyId,
      kind: input.kind,
      hours: new Decimal(input.hours),
      occurredOn: todayUtc(),
      period: null,
      idempotencyKey: input.idempotencyKey,
      detail: null,
      reason: input.reason,
      createdBy: ctx.userId,
    });
    const entry = await tx.ledgerEntry.findUniqueOrThrow({
      where: { companyId_idempotencyKey: { companyId: ctx.companyId, idempotencyKey: input.idempotencyKey } },
    });

    if (!inserted) {
      // a replay of the same request returns the original, the same key with different content is a client bug
      const same =
        entry.employeeId === input.employeeId &&
        entry.policyId === input.policyId &&
        entry.kind === input.kind &&
        new Decimal(entry.hours.toString()).equals(new Decimal(input.hours));
      if (!same) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "this key was already used for a different entry");
      return { entry: toEntryDto(entry), replayed: true };
    }

    await writeAudit(tx, ctx, {
      action: "ADJUSTMENT_CREATED",
      entityType: "ledger_entry",
      entityId: entry.id,
      after: { employeeId: input.employeeId, policyId: input.policyId, kind: input.kind, hours: input.hours },
      reason: input.reason,
    });
    return { entry: toEntryDto(entry), replayed: false };
  });
}

export async function listBalances(prisma: PrismaClient, ctx: Ctx, employeeId: string) {
  const rows = await prisma.balance.findMany({
    where: { companyId: ctx.companyId, employeeId },
    include: { policy: true },
    orderBy: { policy: { name: "asc" } },
  });
  return rows.map((b) => ({
    policyId: b.policyId,
    policyName: b.policy.name,
    type: b.policy.type,
    hours: b.hours.toFixed(4),
  }));
}

export async function listLedger(prisma: PrismaClient, ctx: Ctx, employeeId: string, policyId?: string) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { companyId: ctx.companyId, employeeId, ...(policyId ? { policyId } : {}) },
    orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toEntryDto);
}