-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "hours" DECIMAL(10,4) NOT NULL,
    "occurred_on" DATE NOT NULL,
    "period" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "detail" JSONB,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balances" (
    "employee_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "hours" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balances_pkey" PRIMARY KEY ("employee_id","policy_id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_company_id_employee_id_policy_id_occurred_on_idx" ON "ledger_entries"("company_id", "employee_id", "policy_id", "occurred_on" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_company_id_idempotency_key_key" ON "ledger_entries"("company_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "balances_company_id_employee_id_idx" ON "balances"("company_id", "employee_id");

-- CreateIndex
CREATE INDEX "assignments_company_id_effective_from_idx" ON "assignments"("company_id", "effective_from");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balances" ADD CONSTRAINT "balances_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- a zero hour entry says nothing, so refuse it
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_hours_nonzero CHECK (hours <> 0);

-- the ledger is append-only, reuses the guard function from the policies migration
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();