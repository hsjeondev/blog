SET lock_timeout = '5s';
SET statement_timeout = '15s';

CREATE TABLE public.blog_webhook_deliveries (
  request_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  stage text NOT NULL CHECK (stage ~ '^[a-z_]{1,40}$'),
  status_code integer CHECK (status_code BETWEEN 200 AND 599),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  client_disconnected boolean NOT NULL DEFAULT false,
  signature_valid boolean,
  event_id uuid,
  subscription_id uuid,
  entity_id uuid,
  database_id uuid,
  event_type text CHECK (char_length(event_type) <= 80),
  attempt_number integer CHECK (attempt_number BETWEEN 1 AND 100),
  upstream_status integer CHECK (upstream_status BETWEEN 400 AND 599),
  error_code text CHECK (char_length(error_code) <= 64),
  error_message text CHECK (char_length(error_message) <= 160)
);
CREATE INDEX blog_webhook_deliveries_started ON public.blog_webhook_deliveries (started_at DESC, request_id);
ALTER TABLE public.blog_webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blog_webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_webhook_deliveries TO service_role;

CREATE FUNCTION public.blog_record_webhook_delivery(p_delivery jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p_delivery) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid delivery record'; END IF;
  INSERT INTO public.blog_webhook_deliveries AS existing (
    request_id, started_at, finished_at, stage, status_code, duration_ms, client_disconnected, signature_valid,
    event_id, subscription_id, entity_id, database_id, event_type, attempt_number, upstream_status, error_code, error_message
  ) VALUES (
    (p_delivery->>'request_id')::uuid, (p_delivery->>'started_at')::timestamptz,
    (p_delivery->>'finished_at')::timestamptz, p_delivery->>'stage', (p_delivery->>'status_code')::integer,
    (p_delivery->>'duration_ms')::integer, coalesce((p_delivery->>'client_disconnected')::boolean, false), (p_delivery->>'signature_valid')::boolean,
    (p_delivery->>'event_id')::uuid, (p_delivery->>'subscription_id')::uuid, (p_delivery->>'entity_id')::uuid,
    (p_delivery->>'database_id')::uuid, p_delivery->>'event_type', (p_delivery->>'attempt_number')::integer,
    (p_delivery->>'upstream_status')::integer, p_delivery->>'error_code', p_delivery->>'error_message'
  ) ON CONFLICT (request_id) DO UPDATE SET
    finished_at = excluded.finished_at, stage = excluded.stage, status_code = excluded.status_code,
    duration_ms = excluded.duration_ms, client_disconnected = existing.client_disconnected OR excluded.client_disconnected, signature_valid = excluded.signature_valid,
    event_id = excluded.event_id, subscription_id = excluded.subscription_id, entity_id = excluded.entity_id,
    database_id = excluded.database_id, event_type = excluded.event_type, attempt_number = excluded.attempt_number,
    upstream_status = excluded.upstream_status, error_code = excluded.error_code, error_message = excluded.error_message
  WHERE excluded.duration_ms >= existing.duration_ms
    AND (existing.finished_at IS NULL OR excluded.finished_at IS NOT NULL);

  -- Activity-triggered pruning keeps this private diagnostic log bounded.
  DELETE FROM public.blog_webhook_deliveries WHERE request_id IN (
    SELECT request_id FROM public.blog_webhook_deliveries
    WHERE started_at < now() - interval '30 days' ORDER BY started_at LIMIT 1000
  );
  DELETE FROM public.blog_webhook_deliveries WHERE request_id IN (
    SELECT request_id FROM public.blog_webhook_deliveries ORDER BY started_at DESC, request_id OFFSET 20000 LIMIT 1000
  );
END;
$$;
REVOKE ALL ON FUNCTION public.blog_record_webhook_delivery(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_record_webhook_delivery(jsonb) TO service_role;
COMMENT ON TABLE public.blog_webhook_deliveries IS 'Private webhook diagnostics. No raw payload, credentials, signatures, IPs or content. Status is the intended server response, not proof of receipt by Notion. Unfinished rows may indicate interruption or a failed final log write. Pruned on writes after 30 days or above 20,000 rows.';
