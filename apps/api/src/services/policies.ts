import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import type { createPolicyBody, createVersionBody } from "@repo/shared/policy";
import { Prisma } from "../generated/prisma/client";
import type { Policy, PolicyVersion, PrismaClient } from "../generated/prisma/client";
import type { Ctx } from "../lib/auth";
import { writeAudit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { formatDate, parseDate, todayUtc } from "../lib/dates";

type CreatePolicyInput = z.infer<typeof createPolicyBody>;
type CreateVersionInput = z.infer<typeof createVersionBody>;

const toPolicyDto = (p: Policy) => ({
  id: p.id,
  name: p.name,
  type: p.type,
  createdAt: p.createdAt.toISOString(),
});

const toVersionDto = (v: PolicyVersion) => ({
  id: v.id,
  versionNo: v.versionNo,
  effectiveFrom: formatDate(v.effectiveFrom),
  config: v.config,
  createdBy: v.createdBy,
  reason: v.reason,
  createdAt: v.createdAt.toISOString(),
});

// latest version that has started on or before the date, same date ties go to the higher version_no
// takes the plain client or a transaction client so later features can call it inside their own transaction
export async function versionInForce(db: Prisma.TransactionClient, policyId: string, asOf: string) {
  return db.policyVersion.findFirst({
    where: { policyId, effectiveFrom: { lte: parseDate(asOf) } },
    orderBy: [{ effectiveFrom: "desc" }, { versionNo: "desc" }],
  });
}

export async function createPolicy(prisma: PrismaClient, ctx: Ctx, input: CreatePolicyInput) {
  const policyId = uuidv7();
  try {
    return await prisma.$transaction(async (tx) => {
      const policy = await tx.policy.create({
        data: { id: policyId, companyId: ctx.companyId, name: input.name, type: input.type },
      });
      // the first version may start in the past so existing staff can be backfilled
      const version = await tx.policyVersion.create({
        data: {
          id: uuidv7(),
          policyId,
          versionNo: 1,
          effectiveFrom: parseDate(input.effectiveFrom),
          config: input.config,
          createdBy: ctx.userId,
          reason: input.reason,
        },
      });
      await writeAudit(tx, ctx, {
        action: "POLICY_CREATED",
        entityType: "policy",
        entityId: policyId,
        after: { name: input.name, type: input.type, versionNo: 1, effectiveFrom: input.effectiveFrom, config: input.config },
        reason: input.reason,
      });
      return { policy: toPolicyDto(policy), version: toVersionDto(version) };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "DUPLICATE_NAME", `a policy named "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function listPolicies(prisma: PrismaClient, ctx: Ctx) {
  const today = parseDate(todayUtc());
  const policies = await prisma.policy.findMany({
    where: { companyId: ctx.companyId },
    orderBy: { name: "asc" },
    include: {
      versions: {
        where: { effectiveFrom: { lte: today } },
        orderBy: [{ effectiveFrom: "desc" }, { versionNo: "desc" }],
        take: 1,
      },
    },
  });
  return policies.map((p) => ({
    ...toPolicyDto(p),
    inForce: p.versions[0] ? toVersionDto(p.versions[0]) : null,
  }));
}

export async function getPolicy(prisma: PrismaClient, ctx: Ctx, policyId: string, asOf?: string) {
  const policy = await prisma.policy.findFirst({ where: { id: policyId, companyId: ctx.companyId } });
  if (!policy) throw new AppError(404, "NOT_FOUND", "policy not found");
  const versions = await prisma.policyVersion.findMany({ where: { policyId }, orderBy: { versionNo: "asc" } });
  const current = await versionInForce(prisma, policyId, asOf ?? todayUtc());
  return {
    policy: toPolicyDto(policy),
    versions: versions.map(toVersionDto),
    inForce: current ? toVersionDto(current) : null,
  };
}

export async function createVersion(prisma: PrismaClient, ctx: Ctx, policyId: string, input: CreateVersionInput) {
  // changes only apply going forward, fixing the past is an explicit adjustment in a later feature
  if (input.effectiveFrom < todayUtc()) {
    throw new AppError(422, "EFFECTIVE_DATE_IN_PAST", "a new version must start today or later");
  }
  return prisma.$transaction(async (tx) => {
    // lock the policy row so two concurrent version creates take turns instead of picking the same version_no
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM policies WHERE id = ${policyId}::uuid AND company_id = ${ctx.companyId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new AppError(404, "NOT_FOUND", "policy not found");

    const last = await tx.policyVersion.aggregate({ where: { policyId }, _max: { versionNo: true } });
    const versionNo = (last._max.versionNo ?? 0) + 1;
    const version = await tx.policyVersion.create({
      data: {
        id: uuidv7(),
        policyId,
        versionNo,
        effectiveFrom: parseDate(input.effectiveFrom),
        config: input.config,
        createdBy: ctx.userId,
        reason: input.reason,
      },
    });
    await writeAudit(tx, ctx, {
      action: "POLICY_VERSION_CREATED",
      entityType: "policy",
      entityId: policyId,
      after: { versionNo, effectiveFrom: input.effectiveFrom, config: input.config },
      reason: input.reason,
    });
    return toVersionDto(version);
  });
}