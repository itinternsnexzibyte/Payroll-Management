-- Database-level integrity guards (defence in depth; the API enforces the same rules).

-- 1. Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not permitted)', TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- 2. Results of a FINALISED payroll run are immutable.
CREATE OR REPLACE FUNCTION payroll_finalised_guard() RETURNS trigger AS $$
DECLARE
  run_id uuid;
  run_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN run_id := OLD."payrollRunId"; ELSE run_id := NEW."payrollRunId"; END IF;
  SELECT status::text INTO run_status FROM "payroll_runs" WHERE id = run_id;
  IF run_status = 'FINALISED' THEN
    RAISE EXCEPTION 'Payroll run % is finalised; % on % is not permitted', run_id, TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_lines_finalised
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_lines"
  FOR EACH ROW EXECUTE FUNCTION payroll_finalised_guard();

CREATE TRIGGER trg_payroll_run_employees_finalised
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_run_employees"
  FOR EACH ROW EXECUTE FUNCTION payroll_finalised_guard();

CREATE TRIGGER trg_payroll_inputs_finalised
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_inputs"
  FOR EACH ROW EXECUTE FUNCTION payroll_finalised_guard();

-- 3. Salary versions referenced by payroll are never deleted; values of a version are fixed once created.
CREATE OR REPLACE FUNCTION salary_values_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Salary versions are immutable; create a new version instead' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salary_values_immutable
  BEFORE UPDATE OR DELETE ON "employee_salary_values"
  FOR EACH ROW EXECUTE FUNCTION salary_values_immutable();

-- 4. Case-insensitive uniqueness for business identifiers.
CREATE UNIQUE INDEX "employees_employeeCode_ci_key" ON "employees" (lower("employeeCode"));
CREATE UNIQUE INDEX "users_email_ci_key" ON "users" (lower("email"));
