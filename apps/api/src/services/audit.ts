import type { listAuditQuery } from "@repo/shared/audit";
import type { z } from "zod";
import type { AuditEvent, PrismaClient } from "../generated/prisma/client";
import type { Ctx } from "../lib/auth";

type AuditQuery = z.infer<typeof listAuditQuery>;

const toAuditEventDto = (e: AuditEvent) => ({
  id: e.id,
  actorId: e.actorId,
  actorRole: e.actorRole,
  action: e.action,
  entityType: e.entityType,
  entityId: e.entityId,
  before: e.before,
  after: e.after,
  reason: e.reason,
  createdAt: e.createdAt.toISOString(),
});

// ids are uuidv7, so ordering by id is ordering by time and beforeId works as a cursor
export async function listAuditEvents(prisma: PrismaClient, ctx: Ctx, query: AuditQuery) {
  const rows = await prisma.auditEvent.findMany({
    where: {
      companyId: ctx.companyId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.beforeId ? { id: { lt: query.beforeId } } : {}),
    },
    orderBy: { id: "desc" },
    take: query.limit,
  });
  // a full page may have more behind it, a short page is the end
  const last = rows[rows.length - 1];
  const nextBeforeId = rows.length === query.limit && last ? last.id : null;
  return { events: rows.map(toAuditEventDto), nextBeforeId };
}
