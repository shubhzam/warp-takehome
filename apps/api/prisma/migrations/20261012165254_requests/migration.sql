-- CreateTable
CREATE TABLE "time_off_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "hours" DECIMAL(10,4) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "decided_by" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_off_requests_company_id_status_created_at_idx" ON "time_off_requests"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "time_off_requests_company_id_employee_id_start_date_idx" ON "time_off_requests"("company_id", "employee_id", "start_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "time_off_requests_company_id_idempotency_key_key" ON "time_off_requests"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- the state machine only knows four states, a typo in code fails here
ALTER TABLE time_off_requests ADD CONSTRAINT requests_status_valid
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));

-- one active request per employee per day, rejected and cancelled ones do not count
ALTER TABLE time_off_requests ADD CONSTRAINT requests_no_overlap
  EXCLUDE USING gist (company_id WITH =, employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
  WHERE (status IN ('PENDING', 'APPROVED'));