-- AlterTable
ALTER TABLE "time_off_requests" ADD COLUMN     "computation" JSONB;

-- CreateTable
CREATE TABLE "holiday_calendars" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "calendar_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("calendar_id","date")
);

-- CreateTable
CREATE TABLE "employee_work_schedules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "hours_per_day" DECIMAL(6,4) NOT NULL,
    "work_days" INTEGER[],
    "calendar_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendars_company_id_name_key" ON "holiday_calendars"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_work_schedules_company_id_employee_id_effective_fr_key" ON "employee_work_schedules"("company_id", "employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "holiday_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- one default calendar per company
CREATE UNIQUE INDEX holiday_calendars_one_default ON holiday_calendars (company_id) WHERE is_default;

-- a schedule is a real working day pattern
ALTER TABLE employee_work_schedules ADD CONSTRAINT work_schedules_hours_valid
  CHECK (hours_per_day > 0 AND hours_per_day <= 24);
ALTER TABLE employee_work_schedules ADD CONSTRAINT work_schedules_days_valid
  CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1,2,3,4,5,6,7]);
