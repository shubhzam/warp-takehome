-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "config" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policies_company_id_name_key" ON "policies"("company_id", "name");

-- CreateIndex
CREATE INDEX "policy_versions_policy_id_effective_from_version_no_idx" ON "policy_versions"("policy_id", "effective_from" DESC, "version_no" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policy_id_version_no_key" ON "policy_versions"("policy_id", "version_no");

-- CreateIndex
CREATE INDEX "assignments_policy_id_effective_from_idx" ON "assignments"("policy_id", "effective_from");

-- CreateIndex
CREATE INDEX "audit_events_company_id_entity_type_entity_id_created_at_idx" ON "audit_events"("company_id", "entity_type", "entity_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- lets the exclusion constraint use = on text next to && on ranges
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- an assignment must end after it starts
ALTER TABLE assignments ADD CONSTRAINT assignments_range_valid
  CHECK (effective_to IS NULL OR effective_to > effective_from);

-- one policy per employee per type at any point in time
ALTER TABLE assignments ADD CONSTRAINT assignments_no_overlap
  EXCLUDE USING gist (employee_id WITH =, type WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

-- audit events and policy versions can be inserted but never changed
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER policy_versions_append_only BEFORE UPDATE OR DELETE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
