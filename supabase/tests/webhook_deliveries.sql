BEGIN;
DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'public.blog_webhook_deliveries', 'SELECT');
  ASSERT NOT has_table_privilege('authenticated', 'public.blog_webhook_deliveries', 'SELECT');
  ASSERT NOT has_function_privilege('anon', 'public.blog_record_webhook_delivery(jsonb)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.blog_record_webhook_delivery(jsonb)', 'EXECUTE');
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.blog_webhook_deliveries'::regclass);
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.blog_record_webhook_delivery(jsonb)'::regprocedure);
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE request uuid := gen_random_uuid(); old_request uuid := gen_random_uuid(); payload jsonb;
BEGIN
  payload := jsonb_build_object('request_id',request,'started_at',now(),'stage','received','duration_ms',0);
  PERFORM public.blog_record_webhook_delivery(payload);
  ASSERT (SELECT finished_at IS NULL FROM public.blog_webhook_deliveries WHERE request_id=request);
  PERFORM public.blog_record_webhook_delivery(payload || jsonb_build_object('stage','sync','duration_ms',5));
  PERFORM public.blog_record_webhook_delivery(payload || jsonb_build_object('stage','sync','duration_ms',20,'finished_at',now(),'status_code',503,'error_code','WORKER_BUSY','client_disconnected',true));
  -- A delayed earlier write cannot erase a completed diagnostic record.
  PERFORM public.blog_record_webhook_delivery(payload);
  ASSERT (SELECT status_code=503 AND error_code='WORKER_BUSY' AND client_disconnected FROM public.blog_webhook_deliveries WHERE request_id=request);
  PERFORM public.blog_record_webhook_delivery(payload || jsonb_build_object('request_id',old_request,'started_at',now()-interval '31 days'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.blog_webhook_deliveries WHERE request_id=old_request);
END $$;
ROLLBACK;
