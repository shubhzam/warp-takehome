"use client";

import { AdminOnly } from "../../components/admin-only";
import { MonthlyAccrualCard, PayrollAccrualCard, YearEndCard } from "../../components/operations-cards";
import { PageHeader } from "../../components/ui";

export default function OperationsPage() {
  return (
    <AdminOnly>
      <PageHeader
        title="Operations"
        subtitle="Batch jobs. Each one is safe to run again for the same period, the answer shows what it did this time."
      />
      <div className="ops-grid">
        <MonthlyAccrualCard />
        <PayrollAccrualCard />
        <YearEndCard />
      </div>
    </AdminOnly>
  );
}
