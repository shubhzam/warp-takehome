export type PayrollEntry = { employeeId: string; hoursWorked: string };

// one "employeeId,hoursWorked" per line, commas, tabs or spaces all split a line. a header line is skipped
export function parsePayrollPaste(text: string): { entries: PayrollEntry[]; problem: string | null } {
  const entries: PayrollEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    const parts = line.split(/[\s,;]+/).filter((p) => p !== "");
    if (entries.length === 0 && /^employee/i.test(parts[0] ?? "")) continue;
    const [employeeId, hoursWorked, ...extra] = parts;
    if (!employeeId || hoursWorked === undefined || extra.length > 0) {
      return { entries: [], problem: `Line ${i + 1}: expected "employeeId,hoursWorked", got "${line}"` };
    }
    entries.push({ employeeId, hoursWorked });
  }
  return { entries, problem: null };
}
