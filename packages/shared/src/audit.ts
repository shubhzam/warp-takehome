import { z } from "zod";

const maxLimit = 100;
const defaultLimit = 50;

// filters are all optional, beforeId is the cursor from the previous page
export const listAuditQuery = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.guid().optional(),
  action: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  beforeId: z.guid().optional(),
});
