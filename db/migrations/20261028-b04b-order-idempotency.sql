-- B04-B: add idempotent order identity to orders.
--
-- This migration must be applied inside one transaction. Use psql's -1 flag:
--
--   psql -v ON_ERROR_STOP=1 -1 -f db/migrations/20261028-b04b-order-idempotency.sql
--
-- It is not executed automatically at application startup.
--
-- Initial run: adds two nullable columns and their constraints.
-- Second run: verifies a complete compatible schema and changes nothing.
-- Incomplete or incompatible schema: raises an exception; the transaction
-- rolls back without partial changes.
--
-- Metadata envelope (technical choice):
--   {"version": <positive integer>, "parameters": <JSON object>}
-- The version identifies the metadata format. The parameters object is
-- intentionally open; its complete semantic structure is not defined here.
-- Decimal values inside parameters must be stored as JSON strings.

LOCK TABLE orders IN ACCESS EXCLUSIVE MODE;

DO $b04b$
DECLARE
  expected_pair_definition constant text :=
    $pair_sig$CHECK ((((idempotency_key IS NULL) = (idempotency_metadata IS NULL)) AND ((idempotency_key IS NULL) OR (userid IS NOT NULL))))$pair_sig$;
  expected_metadata_definition constant text :=
    $metadata_sig$CHECK (((idempotency_metadata IS NULL) OR COALESCE(((jsonb_typeof(idempotency_metadata) = 'object'::text) AND (jsonb_typeof((idempotency_metadata -> 'version'::text)) = 'number'::text) AND ((idempotency_metadata ->> 'version'::text) ~ '^[1-9][0-9]*$'::text) AND (jsonb_typeof((idempotency_metadata -> 'parameters'::text)) = 'object'::text)), false)))$metadata_sig$;
  expected_unique_definition constant text :=
    $unique_sig$UNIQUE (userid, idempotency_key)$unique_sig$;
  orders_schema text;
  key_type text;
  key_nullable text;
  key_default text;
  metadata_type text;
  metadata_nullable text;
  metadata_default text;
  columns_added boolean := false;
  expected_unique_columns smallint[];
  constraint_type text;
  constraint_validated boolean;
  constraint_deferrable boolean;
  constraint_deferred boolean;
  constraint_enforced boolean;
  constraint_period boolean;
  constraint_local boolean;
  constraint_inheritance_count smallint;
  constraint_parent oid;
  constraint_no_inherit boolean;
  constraint_columns smallint[];
  constraint_definition text;
BEGIN
  SELECT n.nspname
    INTO orders_schema
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.oid = 'orders'::regclass;

  SELECT data_type, is_nullable, column_default
    INTO key_type, key_nullable, key_default
    FROM information_schema.columns
   WHERE table_schema = orders_schema
     AND table_name = 'orders'
     AND column_name = 'idempotency_key';

  SELECT data_type, is_nullable, column_default
    INTO metadata_type, metadata_nullable, metadata_default
    FROM information_schema.columns
   WHERE table_schema = orders_schema
     AND table_name = 'orders'
     AND column_name = 'idempotency_metadata';

  IF key_type IS NULL AND metadata_type IS NULL THEN
    ALTER TABLE orders ADD COLUMN idempotency_key UUID;
    ALTER TABLE orders ADD COLUMN idempotency_metadata JSONB;
    columns_added := true;
    RAISE NOTICE 'B04-B: idempotency columns added.';
  ELSIF key_type = 'uuid'
        AND key_nullable = 'YES'
        AND key_default IS NULL
        AND metadata_type = 'jsonb'
        AND metadata_nullable = 'YES'
        AND metadata_default IS NULL THEN
    RAISE NOTICE 'B04-B: idempotency columns already present; verifying constraints.';
  ELSE
    RAISE EXCEPTION USING
      MESSAGE = 'B04-B incompatible orders schema: expected both nullable idempotency columns without defaults or neither.',
      DETAIL = format(
        'idempotency_key type=%s nullable=%s default=%s; idempotency_metadata type=%s nullable=%s default=%s',
        coalesce(key_type, '<missing>'),
        coalesce(key_nullable, '<missing>'),
        coalesce(key_default, '<none>'),
        coalesce(metadata_type, '<missing>'),
        coalesce(metadata_nullable, '<missing>'),
        coalesce(metadata_default, '<none>')
      );
  END IF;

  SELECT ARRAY[
    (SELECT attnum
       FROM pg_attribute
      WHERE attrelid = 'orders'::regclass
        AND attname = 'userid'
        AND NOT attisdropped),
    (SELECT attnum
       FROM pg_attribute
      WHERE attrelid = 'orders'::regclass
        AND attname = 'idempotency_key'
        AND NOT attisdropped)
  ] INTO expected_unique_columns;

  constraint_type := NULL;
  constraint_validated := NULL;
  constraint_deferrable := NULL;
  constraint_deferred := NULL;
  constraint_enforced := NULL;
  constraint_period := NULL;
  constraint_local := NULL;
  constraint_inheritance_count := NULL;
  constraint_parent := NULL;
  constraint_no_inherit := NULL;
  constraint_columns := NULL;
  constraint_definition := NULL;

  SELECT contype::text,
         convalidated,
         condeferrable,
         condeferred,
         conenforced,
         conperiod,
         conislocal,
         coninhcount,
         conparentid,
         connoinherit,
         pg_get_constraintdef(oid)
    INTO constraint_type,
         constraint_validated,
         constraint_deferrable,
         constraint_deferred,
         constraint_enforced,
         constraint_period,
         constraint_local,
         constraint_inheritance_count,
         constraint_parent,
         constraint_no_inherit,
         constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass
     AND conname = 'orders_idempotency_pair_check';

  IF constraint_type IS NULL THEN
    IF NOT columns_added THEN
      RAISE EXCEPTION 'B04-B incomplete orders schema: missing constraint orders_idempotency_pair_check.';
    END IF;

    ALTER TABLE orders
      ADD CONSTRAINT orders_idempotency_pair_check
      CHECK (
        (idempotency_key IS NULL) = (idempotency_metadata IS NULL)
        AND (idempotency_key IS NULL OR userid IS NOT NULL)
      );
  ELSIF constraint_type <> 'c'
        OR constraint_validated IS NOT TRUE
        OR constraint_deferrable IS TRUE
        OR constraint_deferred IS TRUE
        OR constraint_enforced IS NOT TRUE
        OR constraint_period IS TRUE
        OR constraint_local IS NOT TRUE
        OR constraint_inheritance_count IS DISTINCT FROM 0
        OR constraint_parent IS DISTINCT FROM 0::oid
        OR constraint_no_inherit IS TRUE
        OR constraint_definition <> expected_pair_definition THEN
    RAISE EXCEPTION 'B04-B incompatible constraint orders_idempotency_pair_check.';
  END IF;

  constraint_type := NULL;
  constraint_validated := NULL;
  constraint_deferrable := NULL;
  constraint_deferred := NULL;
  constraint_enforced := NULL;
  constraint_period := NULL;
  constraint_local := NULL;
  constraint_inheritance_count := NULL;
  constraint_parent := NULL;
  constraint_no_inherit := NULL;
  constraint_columns := NULL;
  constraint_definition := NULL;

  SELECT contype::text,
         convalidated,
         condeferrable,
         condeferred,
         conenforced,
         conperiod,
         conislocal,
         coninhcount,
         conparentid,
         connoinherit,
         pg_get_constraintdef(oid)
    INTO constraint_type,
         constraint_validated,
         constraint_deferrable,
         constraint_deferred,
         constraint_enforced,
         constraint_period,
         constraint_local,
         constraint_inheritance_count,
         constraint_parent,
         constraint_no_inherit,
         constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass
     AND conname = 'orders_idempotency_metadata_check';

  IF constraint_type IS NULL THEN
    IF NOT columns_added THEN
      RAISE EXCEPTION 'B04-B incomplete orders schema: missing constraint orders_idempotency_metadata_check.';
    END IF;

    ALTER TABLE orders
      ADD CONSTRAINT orders_idempotency_metadata_check
      CHECK (
        idempotency_metadata IS NULL
        OR COALESCE(
          jsonb_typeof(idempotency_metadata) = 'object'
          AND jsonb_typeof(idempotency_metadata->'version') = 'number'
          AND (idempotency_metadata->>'version') ~ '^[1-9][0-9]*$'
          AND jsonb_typeof(idempotency_metadata->'parameters') = 'object',
          false
        )
      );
  ELSIF constraint_type <> 'c'
        OR constraint_validated IS NOT TRUE
        OR constraint_deferrable IS TRUE
        OR constraint_deferred IS TRUE
        OR constraint_enforced IS NOT TRUE
        OR constraint_period IS TRUE
        OR constraint_local IS NOT TRUE
        OR constraint_inheritance_count IS DISTINCT FROM 0
        OR constraint_parent IS DISTINCT FROM 0::oid
        OR constraint_no_inherit IS TRUE
        OR constraint_definition <> expected_metadata_definition THEN
    RAISE EXCEPTION 'B04-B incompatible constraint orders_idempotency_metadata_check.';
  END IF;

  constraint_type := NULL;
  constraint_validated := NULL;
  constraint_deferrable := NULL;
  constraint_deferred := NULL;
  constraint_enforced := NULL;
  constraint_period := NULL;
  constraint_local := NULL;
  constraint_inheritance_count := NULL;
  constraint_parent := NULL;
  constraint_no_inherit := NULL;
  constraint_columns := NULL;
  constraint_definition := NULL;

  SELECT contype::text,
         convalidated,
         condeferrable,
         condeferred,
         conenforced,
         conperiod,
         conislocal,
         coninhcount,
         conparentid,
         conkey,
         pg_get_constraintdef(oid)
    INTO constraint_type,
         constraint_validated,
         constraint_deferrable,
         constraint_deferred,
         constraint_enforced,
         constraint_period,
         constraint_local,
         constraint_inheritance_count,
         constraint_parent,
         constraint_columns,
         constraint_definition
    FROM pg_constraint
   WHERE conrelid = 'orders'::regclass
     AND conname = 'orders_user_idempotency_key_unique';

  IF constraint_type IS NULL THEN
    IF NOT columns_added THEN
      RAISE EXCEPTION 'B04-B incomplete orders schema: missing constraint orders_user_idempotency_key_unique.';
    END IF;

    ALTER TABLE orders
      ADD CONSTRAINT orders_user_idempotency_key_unique
      UNIQUE (userid, idempotency_key);
  ELSIF constraint_type <> 'u'
        OR constraint_validated IS NOT TRUE
        OR constraint_deferrable IS TRUE
        OR constraint_deferred IS TRUE
        OR constraint_enforced IS NOT TRUE
        OR constraint_period IS TRUE
        OR constraint_local IS NOT TRUE
        OR constraint_inheritance_count IS DISTINCT FROM 0
        OR constraint_parent IS DISTINCT FROM 0::oid
        OR constraint_columns IS DISTINCT FROM expected_unique_columns
        OR constraint_definition <> expected_unique_definition THEN
    RAISE EXCEPTION 'B04-B incompatible constraint orders_user_idempotency_key_unique.';
  END IF;
END
$b04b$;
