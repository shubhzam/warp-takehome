import { z } from "zod";

export const yearEndBody = z.object({ year: z.number().int().min(2000).max(2100) });