-- CreateTable
CREATE TABLE "employee_start_dates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_start_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_start_dates_company_id_employee_id_key" ON "employee_start_dates"("company_id", "employee_id");
