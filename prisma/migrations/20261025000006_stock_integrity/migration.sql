CREATE OR REPLACE FUNCTION custody_event_digest(event custody_events, previous char(64))
RETURNS char(64)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      concat_ws(
        '|',
        previous,
        event.sequence::text,
        event.id::text,
        event.warehouse_id::text,
        event.vendor_id::text,
        event.lot_id::text,
        event.type::text,
        event.quantity::text,
        coalesce(event.from_location_id::text, ''),
        coalesce(event.to_location_id::text, ''),
        event.actor_id::text,
        event.evidence_file_ids::text,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
      ),
      'sha256'
    ),
    'hex'
  )::char(64);
$$;

CREATE OR REPLACE FUNCTION custody_event_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('custody_events_chain'));
  NEW.sequence := nextval(pg_get_serial_sequence('custody_events', 'sequence'));
  SELECT hash INTO previous FROM custody_events ORDER BY sequence DESC LIMIT 1;
  NEW.prev_hash := coalesce(previous, repeat('0', 64));
  NEW.hash := custody_event_digest(NEW, NEW.prev_hash);
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_events_chain_before_insert
BEFORE INSERT ON custody_events
FOR EACH ROW EXECUTE FUNCTION custody_event_chain();

CREATE TRIGGER custody_events_no_update
BEFORE UPDATE OR DELETE ON custody_events
FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER custody_events_no_truncate
BEFORE TRUNCATE ON custody_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER inventory_movements_no_update
BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER inventory_movements_no_truncate
BEFORE TRUNCATE ON inventory_movements
FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER inbound_photos_no_update
BEFORE UPDATE OR DELETE ON inbound_photos
FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER inbound_messages_no_update
BEFORE UPDATE OR DELETE ON inbound_messages
FOR EACH ROW EXECUTE FUNCTION reject_mutation();
