import { isNegativeHours, negateHours, sumHours } from "./format";
import type { Balance, LedgerEntry, MyAssignment, Preview } from "./types";

// where one assigned policy stands for the employee this calendar year
export type Standing = {
  assignment: MyAssignment;
  taken: string;
  // null for an unlimited policy, it has no balance row
  left: string | null;
};

const TIME_OFF_KINDS = new Set(["TIME_OFF", "TIME_OFF_REVERSAL"]);

// taken is the net of time off and its reversals dated this year. a request that starts next year but was
// cancelled this year would net below zero here, so it is clamped at zero
export function takenThisYear(ledger: LedgerEntry[], policyId: string, year: string): string {
  const amounts = ledger
    .filter((e) => e.policyId === policyId && TIME_OFF_KINDS.has(e.kind) && e.occurredOn.startsWith(year))
    .map((e) => e.hours);
  const net = negateHours(sumHours(amounts));
  return isNegativeHours(net) ? "0.0000" : net;
}

export function buildStandings(
  assignments: MyAssignment[],
  balances: Balance[],
  ledger: LedgerEntry[],
  year: string,
): Standing[] {
  return assignments.map((assignment) => {
    const balance = balances.find((b) => b.policyId === assignment.policyId);
    return {
      assignment,
      taken: takenThisYear(ledger, assignment.policyId, year),
      left: assignment.accrual === "UNLIMITED" ? null : (balance?.hours ?? "0.0000"),
    };
  });
}

// the employee page has no endpoint for the work schedule, a short preview shows what a work day costs
export function dayLengthOf(preview: Preview | null): number | null {
  const day = preview?.days.find((d) => d.kind === "WORKDAY");
  return day ? Number(day.hours) : null;
}
