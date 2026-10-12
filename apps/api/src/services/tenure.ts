import type { setStartDateBody } from "@repo/shared/tenure";
import { uuidv7 } from "uuidv7";
import type { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import { writeAudit } from "../lib/audit";
import type { Ctx } from "../lib/auth";
import { formatDate, parseDate } from "../lib/dates";

type StartDateInput = z.infer<typeof setStartDateBody>;

export type StartDateDto = { employeeId: string; startDate: string | null };

// prisma's unique violation, two first-time puts for one employee can race on the unique index
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" && e !== null && "code" in e && e.code === "P2002";

export async function getStartDate(prisma: PrismaClient, ctx: Ctx, employeeId: string): Promise<StartDateDto> {
  const row = await prisma.employeeStartDate.findUnique({
    where: { companyId_employeeId: { companyId: ctx.companyId, employeeId } },
  });
  return { employeeId, startDate: row ? formatDate(row.startDate) : null };
}

async function writeStartDate(
  prisma: PrismaClient,
  ctx: Ctx,
  employeeId: string,
  input: StartDateInput,
): Promise<StartDateDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.employeeStartDate.findUnique({
      where: { companyId_employeeId: { companyId: ctx.companyId, employeeId } },
    });

    // same date again changes nothing, so it writes no audit row either
    if (existing && formatDate(existing.startDate) === input.startDate) {
      return { employeeId, startDate: input.startDate };
    }

    const row = existing
      ? await tx.employeeStartDate.update({
          where: { id: existing.id },
          data: { startDate: parseDate(input.startDate) },
        })
      : await tx.employeeStartDate.create({
          data: { id: uuidv7(), companyId: ctx.companyId, employeeId, startDate: parseDate(input.startDate) },
        });

    await writeAudit(tx, ctx, {
      action: "EMPLOYEE_START_DATE_SET",
      entityType: "employee_start_date",
      entityId: row.id,
      before: existing ? { employeeId, startDate: formatDate(existing.startDate) } : undefined,
      after: { employeeId, startDate: input.startDate },
    });
    return { employeeId, startDate: input.startDate };
  });
}

// a lost race on the unique index is retried once, the second attempt sees the row and updates it
export async function setStartDate(
  prisma: PrismaClient,
  ctx: Ctx,
  employeeId: string,
  input: StartDateInput,
): Promise<StartDateDto> {
  try {
    return await writeStartDate(prisma, ctx, employeeId, input);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return await writeStartDate(prisma, ctx, employeeId, input);
  }
}