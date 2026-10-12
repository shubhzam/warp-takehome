import type { PolicyConfig, TimeOffType } from "@repo/shared/policy";

export type { PolicyConfig, TimeOffType };

export type PolicyVersion = {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  config: PolicyConfig;
  createdBy: string;
  reason: string | null;
  createdAt: string;
};

export type Policy = { id: string; name: string; type: TimeOffType; createdAt: string };
export type PolicySummary = Policy & { inForce: PolicyVersion | null };
export type PolicyDetail = { policy: Policy; versions: PolicyVersion[]; inForce: PolicyVersion | null };

export type Assignment = {
  id: string;
  employeeId: string;
  policyId: string;
  type: TimeOffType;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type AccrualKind = "UNLIMITED" | "TIME" | "HOURS_WORKED";

export type MyAssignment = {
  policyId: string;
  policyName: string;
  type: TimeOffType;
  accrual: AccrualKind;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type Balance = { policyId: string; policyName: string; type: TimeOffType; hours: string };

export type LedgerKind = "ACCRUAL" | "ADJUSTMENT" | "TIME_OFF" | "TIME_OFF_REVERSAL" | "EXPIRATION";

export type AccrualSegment = { versionNo: number; days: number; monthlyHours: string; tenureYears?: number };

export type LedgerEntry = {
  id: string;
  employeeId: string;
  policyId: string;
  kind: LedgerKind;
  hours: string;
  occurredOn: string;
  period: string | null;
  detail: unknown;
  reason: string | null;
  createdBy: string;
  createdAt: string;
};

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type DayKind = "WORKDAY" | "HOLIDAY" | "NON_WORKDAY";
export type PricedDay = { date: string; kind: DayKind; hours: string; holidayName?: string };

export type Computation = { source: "COMPUTED" | "GIVEN"; scheduledHours: string; days: PricedDay[] };

export type TimeOffRequest = {
  id: string;
  employeeId: string;
  policyId: string;
  type: TimeOffType;
  startDate: string;
  endDate: string;
  hours: string;
  status: RequestStatus;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  computation: Computation | null;
  createdAt: string;
};

export type Preview = {
  employeeId: string;
  startDate: string;
  endDate: string;
  hours: string;
  days: PricedDay[];
};

export type Calendar = { id: string; name: string; isDefault: boolean };
export type CalendarSummary = Calendar & { holidayCount: number };
export type Holiday = { date: string; name: string };
export type CalendarDetail = { calendar: Calendar; holidays: Holiday[] };
export type HolidayCounts = { added: number; updated: number; unchanged: number };

export type WorkSchedule = {
  id: string | null;
  employeeId: string;
  effectiveFrom: string | null;
  hoursPerDay: string;
  workDays: number[];
  calendarId: string | null;
  source: "SCHEDULE" | "STANDARD";
};
export type WorkScheduleView = { inForce: WorkSchedule; history: WorkSchedule[] };

export type AuditEvent = {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
};
export type AuditPage = { events: AuditEvent[]; nextBeforeId: string | null };

export type StartDate = { employeeId: string; startDate: string | null };
