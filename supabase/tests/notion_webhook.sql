BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE blog_hook_fixture_ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
INSERT INTO blog_hook_fixture_ids (name) VALUES ('a'), ('b'), ('private'), ('source'), ('worker_a'), ('worker_b'), ('event_a'), ('event_b');
GRANT SELECT ON blog_hook_fixture_ids TO anon, service_role;
CREATE TEMP TABLE blog_hook_fixture_snapshot ON COMMIT DROP AS
SELECT jsonb_agg(jsonb_build_object(
  'post', jsonb_build_object('id', id, 'title', 'Sync fixture', 'author', '', 'category', '독서', 'tags', '[]'::jsonb,
    'kind', 'post', 'description', '', 'folder_path', '', 'written_at', now(), 'notion_created_at', now(), 'notion_edited_at', now()),
  'content', jsonb_build_object('record_map', jsonb_build_object('block', jsonb_build_object(id::text, jsonb_build_object('value', jsonb_build_object('id', id, 'type', 'page')))),
    'plain_text', 'Temporary fixture', 'reading_minutes', 0, 'source_edited_at', now(),
    'referenced_page_ids', CASE WHEN name = 'a' THEN (SELECT jsonb_build_array(id) FROM blog_hook_fixture_ids WHERE name = 'b') ELSE '[]'::jsonb END),
  'links', CASE WHEN name = 'a' THEN (SELECT jsonb_build_array(id) FROM blog_hook_fixture_ids WHERE name = 'b') ELSE '[]'::jsonb END
) ORDER BY name) AS books, public.blog_sync_started_at() AS started
FROM blog_hook_fixture_ids WHERE name IN ('a', 'b');
GRANT SELECT ON blog_hook_fixture_snapshot TO service_role;

SET LOCAL ROLE service_role;
SELECT public.blog_commit_notion_snapshot((SELECT id FROM blog_hook_fixture_ids WHERE name = 'source'), public.blog_sync_started_at(), (SELECT books FROM blog_hook_fixture_snapshot));
DO $$
DECLARE src uuid; a uuid; b uuid; wa uuid; wb uuid; ea text; eb text; job jsonb; next_job jsonb; book jsonb; result jsonb; i integer;
BEGIN
  SELECT id INTO src FROM blog_hook_fixture_ids WHERE name = 'source';
  SELECT id INTO a FROM blog_hook_fixture_ids WHERE name = 'a';
  SELECT id INTO b FROM blog_hook_fixture_ids WHERE name = 'b';
  SELECT id INTO wa FROM blog_hook_fixture_ids WHERE name = 'worker_a';
  SELECT id INTO wb FROM blog_hook_fixture_ids WHERE name = 'worker_b';
  SELECT id::text INTO ea FROM blog_hook_fixture_ids WHERE name = 'event_a';
  SELECT id::text INTO eb FROM blog_hook_fixture_ids WHERE name = 'event_b';
  SELECT books->0 INTO book FROM blog_hook_fixture_snapshot;
  PERFORM public.blog_store_webhook_verification('fixture-verification-' || src::text);
  PERFORM public.blog_store_webhook_verification('fixture-verification-' || src::text);
  IF (SELECT count(*) FROM public.blog_webhook_verifications WHERE verification_token = 'fixture-verification-' || src::text) <> 1 THEN RAISE EXCEPTION 'verification duplicated'; END IF;
  PERFORM public.blog_enqueue_notion_event(src, ea, 'page.properties_updated', b, now());
  PERFORM public.blog_enqueue_notion_event(src, ea, 'page.properties_updated', b, now());
  IF (SELECT count(*) FROM public.blog_sync_events WHERE event_id = ea) <> 1 THEN RAISE EXCEPTION 'event duplicated'; END IF;
  job := public.blog_claim_notion_event(src, wa);
  IF job->>'status' <> 'claimed' OR job->>'id' <> ea THEN RAISE EXCEPTION 'claim failed'; END IF;
  IF public.blog_claim_notion_event(src, wb)->>'status' <> 'busy' THEN RAISE EXCEPTION 'two workers acquired same source'; END IF;
  BEGIN
    PERFORM public.blog_commit_notion_page(src, wb, ea, b, public.blog_sync_started_at(), NULL, jsonb_build_array(a));
    RAISE EXCEPTION 'wrong worker wrote page';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Notion worker lease lost' THEN RAISE; END IF; END;
  PERFORM public.blog_commit_notion_page(src, wa, ea, b, public.blog_sync_started_at(), NULL, jsonb_build_array(a));
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = b AND NOT is_published AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'webhook did not soft-delete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = a AND sync_status = 'pending') THEN RAISE EXCEPTION 'stale mention was not hidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_post_contents WHERE post_id = b) THEN RAISE EXCEPTION 'soft delete destroyed body'; END IF;
  PERFORM public.blog_finish_notion_event(src, wa, ea, true, NULL);
  next_job := public.blog_claim_notion_event(src, wa);
  IF next_job->>'type' <> 'page.content_updated' OR (next_job->>'pageId')::uuid <> a THEN RAISE EXCEPTION 'dependent refresh not queued before graph'; END IF;
  book := jsonb_set(jsonb_set(book, '{links}', '[]'), '{content,referenced_page_ids}', '[]');
  PERFORM public.blog_commit_notion_page(src, wa, next_job->>'id', a, public.blog_sync_started_at(), book, jsonb_build_array(a));
  PERFORM public.blog_finish_notion_event(src, wa, next_job->>'id', true, NULL);
  FOR i IN 1..5 LOOP
    job := public.blog_claim_notion_event(src, wa);
    EXIT WHEN job->>'status' = 'empty';
    IF job->>'type' <> 'graph.refresh' THEN RAISE EXCEPTION 'unexpected derived job'; END IF;
    PERFORM public.blog_commit_notion_graph(src, wa, job->>'id', public.blog_sync_started_at(), jsonb_build_array(a), '[]');
    PERFORM public.blog_finish_notion_event(src, wa, job->>'id', true, NULL);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.blog_sync_events WHERE notion_database_id = src AND status <> 'done') THEN RAISE EXCEPTION 'derived jobs not completed'; END IF;
  PERFORM public.blog_release_notion_worker(src, wa);
  IF public.blog_enqueue_notion_event(src, ea, 'page.properties_updated', b, now()) <> 'done' THEN RAISE EXCEPTION 'duplicate done event replayed'; END IF;
  IF (SELECT attempts FROM public.blog_sync_events WHERE event_id = ea) <> 1 THEN RAISE EXCEPTION 'completed event reprocessed'; END IF;
  PERFORM public.blog_enqueue_notion_event(src, eb, 'page.content_updated', a, now());
  job := public.blog_claim_notion_event(src, wa);
  UPDATE public.blog_sync_state SET worker_expires_at = clock_timestamp() - interval '1 second' WHERE notion_database_id = src;
  next_job := public.blog_claim_notion_event(src, wb);
  IF next_job->>'id' <> eb OR (SELECT attempts FROM public.blog_sync_events WHERE event_id = eb) <> 2 THEN RAISE EXCEPTION 'expired worker was not reclaimed'; END IF;
  BEGIN
    PERFORM public.blog_finish_notion_event(src, wa, eb, true, NULL);
    RAISE EXCEPTION 'expired worker completed reclaimed event';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Notion worker lease lost' THEN RAISE; END IF; END;
  PERFORM public.blog_commit_notion_page(src, wb, eb, a, public.blog_sync_started_at(), book, jsonb_build_array(a));
  PERFORM public.blog_finish_notion_event(src, wb, eb, true, NULL);
  PERFORM public.blog_release_notion_worker(src, wb);
  PERFORM public.blog_enqueue_notion_event(src, 'failed:' || ea, 'page.content_updated', a, now());
  job := public.blog_claim_notion_event(src, wa);
  PERFORM public.blog_finish_notion_event(src, wa, job->>'id', false, 'fixture retry failure');
  PERFORM public.blog_release_notion_worker(src, wa);
  IF public.blog_claim_notion_event(src, wb)->>'status' <> 'waiting' THEN RAISE EXCEPTION 'retry backoff ignored'; END IF;
  PERFORM public.blog_retry_failed_notion_events(src);
  job := public.blog_claim_notion_event(src, wb);
  IF job->>'status' <> 'claimed' THEN RAISE EXCEPTION 'manual retry did not claim'; END IF;
  PERFORM public.blog_finish_notion_event(src, wb, job->>'id', true, NULL);
  PERFORM public.blog_release_notion_worker(src, wb);
  PERFORM public.blog_enqueue_notion_event(src, 'comment:' || ea, 'comment.updated', a, now());
  job := public.blog_claim_notion_event(src, wa);
  PERFORM public.blog_commit_notion_page(src, wa, job->>'id', a, public.blog_sync_started_at(),
    jsonb_build_object('links_only',true,'post',book->'post','links','[]'::jsonb), jsonb_build_array(a));
  IF (SELECT plain_text FROM public.blog_post_contents WHERE post_id = a) <> 'Temporary fixture' THEN RAISE EXCEPTION 'comment update replaced the body'; END IF;
  PERFORM public.blog_finish_notion_event(src, wa, job->>'id', true, NULL);
  PERFORM public.blog_release_notion_worker(src, wa);
  INSERT INTO public.blog_sync_events (event_id,event_type,entity_id,notion_database_id,event_time,status,attempts)
    VALUES ('exhausted:' || ea,'page.content_updated',a,src,now(),'failed',12);
  IF public.blog_claim_notion_event(src, wa)->>'status' <> 'empty' THEN RAISE EXCEPTION 'exhausted event blocks later work'; END IF;
END; $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM verification_token FROM public.blog_webhook_verifications; RAISE EXCEPTION 'public can read verification token'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF has_function_privilege(current_user, 'public.blog_claim_notion_event(uuid,uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'public can claim work'; END IF;
  IF has_function_privilege(current_user, 'public.blog_store_webhook_verification(text)', 'EXECUTE') THEN RAISE EXCEPTION 'public can store token through RPC'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE id IN (SELECT id FROM blog_hook_fixture_ids WHERE name = 'b')) THEN RAISE EXCEPTION 'revoked fixture remains public'; END IF;
END; $$;
RESET ROLE;
SELECT 'webhook_access_and_recovery_verified' AS result;
ROLLBACK;
