import { z } from "zod";

// employee ids are opaque strings, nothing checks them against an employee table
export const employeeIdParam = z.string().min(1).max(100);

export const setStartDateBody = z.object({
  startDate: z.iso.date().refine((d) => d >= "1950-01-01", { message: "startDate must not be before 1950-01-01" }),
});