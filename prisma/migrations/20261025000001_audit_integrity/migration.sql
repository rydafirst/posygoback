CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION audit_entry_digest(entry audit_log_entries, previous char(64))
RETURNS char(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        previous,
        entry.sequence::text,
        entry.id::text,
        coalesce(entry.actor_id::text, ''),
        coalesce(entry.actor_role::text, ''),
        coalesce(entry.country_code, ''),
        coalesce(entry.vendor_id::text, ''),
        entry.action,
        entry.resource_type,
        coalesce(entry.resource_id, ''),
        coalesce(entry.before_state::text, ''),
        coalesce(entry.after_state::text, ''),
        coalesce(entry.ip, ''),
        coalesce(entry.user_agent, ''),
        coalesce(entry.correlation_id, ''),
        to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
      ),
      'sha256'
    ),
    'hex'
  )::char(64);
$$;

CREATE OR REPLACE FUNCTION audit_log_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_entries_chain'));
  NEW.sequence := nextval(pg_get_serial_sequence('audit_log_entries', 'sequence'));
  SELECT hash INTO previous FROM audit_log_entries ORDER BY sequence DESC LIMIT 1;
  NEW.prev_hash := coalesce(previous, repeat('0', 64));
  NEW.hash := audit_entry_digest(NEW, NEW.prev_hash);
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_log_chain_before_insert
BEFORE INSERT ON audit_log_entries
FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_entries_no_update
BEFORE UPDATE OR DELETE ON audit_log_entries
FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER audit_log_entries_no_truncate
BEFORE TRUNCATE ON audit_log_entries
FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
