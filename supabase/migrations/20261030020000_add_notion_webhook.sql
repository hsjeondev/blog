BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.blog_sync_events ADD COLUMN lease_id uuid;
ALTER TABLE public.blog_sync_state ADD COLUMN worker_id uuid, ADD COLUMN worker_expires_at timestamptz;
CREATE TABLE public.blog_webhook_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_token text NOT NULL UNIQUE CHECK (char_length(verification_token) BETWEEN 16 AND 200),
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blog_webhook_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blog_webhook_verifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.blog_webhook_verifications TO service_role;
COMMENT ON TABLE public.blog_webhook_verifications IS 'Private setup inbox only; tokens are never activated automatically or returned by the public webhook.';

CREATE FUNCTION public.blog_upsert_notion_book(p_database uuid, item jsonb, ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE refs uuid[];
BEGIN
  IF NOT (item->'post'->>'id')::uuid = ANY(ids) THEN RAISE EXCEPTION 'Page is not in public catalog'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE id = (item->'post'->>'id')::uuid
    AND (notion_database_id <> p_database OR notion_edited_at > (item->'post'->>'notion_edited_at')::timestamptz)) THEN
    RAISE EXCEPTION 'Foreign database or older page revision';
  END IF;
    IF jsonb_typeof(item->'content'->'record_map'->'block'->(item->'post'->>'id')) IS DISTINCT FROM 'object'
      OR (item->'content'->>'source_edited_at')::timestamptz IS DISTINCT FROM (item->'post'->>'notion_edited_at')::timestamptz THEN
      RAISE EXCEPTION 'Incomplete or mismatched blog body';
    END IF;
    SELECT coalesce(array_agg(value::uuid), '{}') INTO refs FROM jsonb_array_elements_text(item->'content'->'referenced_page_ids');
    IF NOT refs <@ ids THEN RAISE EXCEPTION 'Body references a non-public page'; END IF;

    INSERT INTO public.blog_posts (id, notion_database_id, title, author, category, tags, kind, description, folder_path, icon, cover,
      written_at, notion_created_at, notion_edited_at, is_published, sync_status, synced_at, deleted_at)
    SELECT post.id, p_database, post.title, post.author, post.category, post.tags, post.kind, post.description, post.folder_path,
      post.icon, post.cover, post.written_at, post.notion_created_at, post.notion_edited_at, true, 'ready', now(), NULL
    FROM jsonb_to_record(item->'post') AS post(id uuid, title text, author text, category text, tags jsonb, kind text,
      description text, folder_path text, icon jsonb, cover jsonb, written_at timestamptz, notion_created_at timestamptz, notion_edited_at timestamptz)
    ON CONFLICT (id) DO UPDATE SET title = excluded.title, author = excluded.author, category = excluded.category, tags = excluded.tags,
      kind = excluded.kind, description = excluded.description, folder_path = excluded.folder_path, icon = excluded.icon, cover = excluded.cover,
      written_at = excluded.written_at, notion_created_at = excluded.notion_created_at, notion_edited_at = excluded.notion_edited_at,
      is_published = true, sync_status = 'ready', synced_at = now(), deleted_at = NULL;

    INSERT INTO public.blog_post_contents (post_id, record_map, plain_text, reading_minutes, source_edited_at, referenced_page_ids, synced_at)
    VALUES ((item->'post'->>'id')::uuid, item->'content'->'record_map', item->'content'->>'plain_text',
      (item->'content'->>'reading_minutes')::integer, (item->'content'->>'source_edited_at')::timestamptz, refs, now())
    ON CONFLICT (post_id) DO UPDATE SET record_map = excluded.record_map, plain_text = excluded.plain_text,
      reading_minutes = excluded.reading_minutes, source_edited_at = excluded.source_edited_at,
      referenced_page_ids = excluded.referenced_page_ids, synced_at = now();
END; $$;

CREATE OR REPLACE FUNCTION public.blog_commit_notion_snapshot(p_database uuid, p_started_at timestamptz, p_books jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  item jsonb;
  ids uuid[];
  refs uuid[];
  previous_success timestamptz;
  removed integer;
  linked integer;
BEGIN
  IF p_database IS NULL OR p_started_at IS NULL OR jsonb_typeof(p_books) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid blog snapshot';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('blog-sync:' || p_database::text, 0));
  SELECT last_success_at INTO previous_success FROM public.blog_sync_state WHERE notion_database_id = p_database;
  IF previous_success > p_started_at THEN RAISE EXCEPTION 'Stale blog snapshot'; END IF;
  IF p_started_at > clock_timestamp() THEN RAISE EXCEPTION 'Invalid future snapshot'; END IF;

  SELECT coalesce(array_agg((book->'post'->>'id')::uuid), '{}') INTO ids FROM jsonb_array_elements(p_books) book;
  IF array_position(ids, NULL) IS NOT NULL OR cardinality(ids) <> (SELECT count(DISTINCT id) FROM unnest(ids) id) THEN
    RAISE EXCEPTION 'Invalid or duplicate snapshot page IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blog_posts post JOIN jsonb_array_elements(p_books) book ON post.id = (book->'post'->>'id')::uuid
    WHERE post.notion_database_id <> p_database OR post.notion_edited_at > (book->'post'->>'notion_edited_at')::timestamptz) THEN
    RAISE EXCEPTION 'Foreign database or older page revision';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_books) LOOP
    PERFORM public.blog_upsert_notion_book(p_database, item, ids);
  END LOOP;

  UPDATE public.blog_posts SET is_published = false, deleted_at = coalesce(deleted_at, now()), synced_at = now()
    WHERE notion_database_id = p_database AND NOT id = ANY(ids) AND (is_published OR deleted_at IS NULL);
  GET DIAGNOSTICS removed = ROW_COUNT;

  DELETE FROM public.blog_post_links link WHERE origin = 'notion_comment' AND source_id = ANY(ids);
  INSERT INTO public.blog_post_links (source_id, target_id, origin)
  SELECT DISTINCT (book->'post'->>'id')::uuid, target::uuid, 'notion_comment'
  FROM jsonb_array_elements(p_books) book CROSS JOIN LATERAL jsonb_array_elements_text(book->'links') target
  WHERE target::uuid = ANY(ids) AND target::uuid <> (book->'post'->>'id')::uuid
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS linked = ROW_COUNT;

  INSERT INTO public.blog_sync_state (notion_database_id, last_full_sync_at, last_success_at)
  VALUES (p_database, clock_timestamp(), clock_timestamp())
  ON CONFLICT (notion_database_id) DO UPDATE SET last_full_sync_at = excluded.last_full_sync_at,
    last_success_at = excluded.last_success_at, last_error_at = NULL, last_error = NULL;
  RETURN jsonb_build_object('synced', cardinality(ids), 'softDeleted', removed, 'links', linked);
END; $$;

CREATE FUNCTION public.blog_store_webhook_verification(p_token text) RETURNS boolean
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF char_length(p_token) NOT BETWEEN 16 AND 200 THEN RAISE EXCEPTION 'Invalid verification token'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('blog-webhook-setup', 0));
  DELETE FROM public.blog_webhook_verifications WHERE received_at < now() - interval '7 days';
  IF EXISTS (SELECT 1 FROM public.blog_webhook_verifications WHERE verification_token = p_token) THEN RETURN true; END IF;
  IF (SELECT count(*) FROM public.blog_webhook_verifications) >= 32 THEN RETURN false; END IF;
  INSERT INTO public.blog_webhook_verifications (verification_token) VALUES (p_token);
  RETURN true;
END; $$;

CREATE FUNCTION public.blog_enqueue_notion_event(p_database uuid, p_event text, p_type text, p_page uuid, p_time timestamptz) RETURNS text
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE current_status text;
BEGIN
  IF p_database IS NULL OR p_page IS NULL OR p_event IS NULL OR p_time IS NULL THEN RAISE EXCEPTION 'Invalid event'; END IF;
  INSERT INTO public.blog_sync_events (event_id, event_type, entity_id, notion_database_id, event_time)
  VALUES (p_event, p_type, p_page, p_database, p_time) ON CONFLICT (event_id) DO NOTHING;
  SELECT status INTO current_status FROM public.blog_sync_events WHERE event_id = p_event AND notion_database_id = p_database;
  IF current_status IS NULL THEN RAISE EXCEPTION 'Event source mismatch'; END IF;
  RETURN current_status;
END; $$;

CREATE FUNCTION public.blog_claim_notion_event(p_database uuid, p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE job public.blog_sync_events; holder public.blog_sync_state; remaining integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('blog-sync:' || p_database::text, 0));
  INSERT INTO public.blog_sync_state (notion_database_id) VALUES (p_database) ON CONFLICT DO NOTHING;
  SELECT * INTO holder FROM public.blog_sync_state WHERE notion_database_id = p_database FOR UPDATE;
  IF holder.worker_id IS NOT NULL AND holder.worker_id <> p_worker AND holder.worker_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  UPDATE public.blog_sync_events SET status = 'failed', available_at = now(), lease_id = NULL, locked_at = NULL,
    last_error = 'Previous worker lease expired'
  WHERE notion_database_id = p_database AND status = 'processing' AND lease_id IS DISTINCT FROM p_worker;
  SELECT * INTO job FROM public.blog_sync_events
  WHERE notion_database_id = p_database AND status IN ('pending', 'failed') AND attempts < 12 AND available_at <= clock_timestamp()
  ORDER BY CASE WHEN event_type = 'graph.refresh' THEN 2 WHEN event_type IN ('page.properties_updated', 'page.deleted', 'page.moved') THEN 0 ELSE 1 END, received_at, event_id
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF job.event_id IS NULL THEN
    SELECT count(*) INTO remaining FROM public.blog_sync_events WHERE notion_database_id = p_database AND status <> 'done' AND attempts < 12;
    RETURN jsonb_build_object('status', CASE WHEN remaining = 0 THEN 'empty' ELSE 'waiting' END, 'remaining', remaining);
  END IF;
  UPDATE public.blog_sync_state SET worker_id = p_worker, worker_expires_at = clock_timestamp() + interval '55 seconds'
    WHERE notion_database_id = p_database;
  UPDATE public.blog_sync_events SET status = 'processing', attempts = attempts + 1, locked_at = clock_timestamp(), lease_id = p_worker
    WHERE event_id = job.event_id;
  RETURN jsonb_build_object('status', 'claimed', 'id', job.event_id, 'type', job.event_type, 'pageId', job.entity_id);
END; $$;

CREATE FUNCTION public.blog_assert_notion_lease(p_database uuid, p_worker uuid, p_event text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('blog-sync:' || p_database::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.blog_sync_state WHERE notion_database_id = p_database AND worker_id = p_worker AND worker_expires_at > clock_timestamp())
    OR NOT EXISTS (SELECT 1 FROM public.blog_sync_events WHERE event_id = p_event AND notion_database_id = p_database AND status = 'processing' AND lease_id = p_worker) THEN
    RAISE EXCEPTION 'Notion worker lease lost';
  END IF;
END; $$;

CREATE FUNCTION public.blog_finish_notion_event(p_database uuid, p_worker uuid, p_event text, p_success boolean, p_error text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM public.blog_assert_notion_lease(p_database, p_worker, p_event);
  UPDATE public.blog_sync_events SET status = CASE WHEN p_success THEN 'done' ELSE 'failed' END,
    processed_at = CASE WHEN p_success THEN clock_timestamp() ELSE NULL END,
    available_at = clock_timestamp() + make_interval(secs => least(300, (5 * power(2, least(attempts, 6)))::integer)),
    last_error = CASE WHEN p_success THEN NULL ELSE left(p_error, 500) END, lease_id = NULL, locked_at = NULL
  WHERE event_id = p_event;
END; $$;

CREATE FUNCTION public.blog_release_notion_worker(p_database uuid, p_worker uuid) RETURNS void
LANGUAGE sql SET search_path = pg_catalog AS $$
  UPDATE public.blog_sync_state SET worker_id = NULL, worker_expires_at = NULL WHERE notion_database_id = p_database AND worker_id = p_worker;
$$;

CREATE FUNCTION public.blog_retry_failed_notion_events(p_database uuid) RETURNS void
LANGUAGE sql SET search_path = pg_catalog AS $$
  UPDATE public.blog_sync_events SET status = 'pending', attempts = 0, available_at = clock_timestamp(), last_error = NULL
  WHERE notion_database_id = p_database AND status = 'failed';
$$;

CREATE FUNCTION public.blog_commit_notion_page(p_database uuid, p_worker uuid, p_event text, p_page uuid,
  p_started_at timestamptz, p_book jsonb, p_public_ids jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE ids uuid[]; was_public boolean; removed integer; dependent integer;
BEGIN
  PERFORM public.blog_assert_notion_lease(p_database, p_worker, p_event);
  IF p_started_at IS NULL OR p_started_at > clock_timestamp() OR jsonb_typeof(p_public_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid page snapshot'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_sync_state WHERE notion_database_id = p_database AND last_success_at > p_started_at) THEN RAISE EXCEPTION 'Stale blog snapshot'; END IF;
  SELECT coalesce(array_agg(value::uuid), '{}') INTO ids FROM jsonb_array_elements_text(p_public_ids);
  SELECT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = p_page AND notion_database_id = p_database AND is_published AND sync_status = 'ready' AND deleted_at IS NULL) INTO was_public;
  IF p_book IS NOT NULL AND p_book <> 'null'::jsonb THEN
    IF (p_book->'post'->>'id')::uuid IS DISTINCT FROM p_page THEN RAISE EXCEPTION 'Page mismatch'; END IF;
    IF p_book->>'links_only' = 'true' THEN
      IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = p_page AND notion_database_id = p_database
        AND notion_edited_at = (p_book->'post'->>'notion_edited_at')::timestamptz AND is_published AND deleted_at IS NULL AND sync_status = 'ready') THEN
        UPDATE public.blog_posts SET sync_status = 'pending' WHERE id = p_page AND notion_database_id = p_database AND is_published AND deleted_at IS NULL;
      END IF;
    ELSE
      PERFORM public.blog_upsert_notion_book(p_database, p_book, ids);
    END IF;
    DELETE FROM public.blog_post_links WHERE source_id = p_page AND origin = 'notion_comment';
    INSERT INTO public.blog_post_links (source_id, target_id, origin)
    SELECT p_page, target.id, 'notion_comment' FROM public.blog_posts target CROSS JOIN public.blog_posts source
    WHERE target.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_book->'links'))
      AND source.id = p_page AND source.notion_database_id = p_database AND source.is_published AND source.sync_status = 'ready' AND source.deleted_at IS NULL
      AND target.id = ANY(ids) AND target.id <> p_page AND target.notion_database_id = p_database
      AND target.is_published AND target.sync_status = 'ready' AND target.deleted_at IS NULL ON CONFLICT DO NOTHING;
  ELSIF p_page = ANY(ids) THEN RAISE EXCEPTION 'Revocation page is still public';
  END IF;
  UPDATE public.blog_posts SET is_published = false, deleted_at = coalesce(deleted_at, now()), synced_at = now()
    WHERE notion_database_id = p_database AND NOT id = ANY(ids) AND (is_published OR deleted_at IS NULL);
  GET DIAGNOSTICS removed = ROW_COUNT;
  UPDATE public.blog_posts post SET sync_status = 'pending'
    FROM public.blog_post_contents body WHERE body.post_id = post.id AND post.notion_database_id = p_database
      AND post.is_published AND post.deleted_at IS NULL AND NOT body.referenced_page_ids <@ ids;
  GET DIAGNOSTICS dependent = ROW_COUNT;
  -- Missing/newly published targets and bodies hiding revoked mentions are
  -- repaired before acknowledging the originating Notion delivery.
  INSERT INTO public.blog_sync_events (event_id, event_type, entity_id, notion_database_id, event_time)
  SELECT 'derived:' || md5(p_event || candidate::text), 'page.content_updated', candidate, p_database, clock_timestamp()
  FROM unnest(ids) candidate LEFT JOIN public.blog_posts post ON post.id = candidate
  WHERE post.id IS NULL OR (post.notion_database_id = p_database AND post.sync_status = 'pending' AND post.deleted_at IS NULL)
  ON CONFLICT DO NOTHING;
  IF removed > 0 OR dependent > 0 OR (NOT was_public AND p_book IS NOT NULL AND p_book <> 'null'::jsonb) THEN
    INSERT INTO public.blog_sync_events (event_id, event_type, entity_id, notion_database_id, event_time)
    VALUES ('graph:' || md5(p_event), 'graph.refresh', p_database, p_database, clock_timestamp()) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.blog_sync_state (notion_database_id, last_success_at) VALUES (p_database, clock_timestamp())
    ON CONFLICT (notion_database_id) DO UPDATE SET last_success_at = excluded.last_success_at, last_error = NULL, last_error_at = NULL;
  RETURN jsonb_build_object('softDeleted', removed, 'dependentPending', dependent);
END; $$;

CREATE FUNCTION public.blog_commit_notion_graph(p_database uuid, p_worker uuid, p_event text, p_started_at timestamptz,
  p_public_ids jsonb, p_links jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE ids uuid[];
BEGIN
  PERFORM public.blog_assert_notion_lease(p_database, p_worker, p_event);
  IF jsonb_typeof(p_public_ids) IS DISTINCT FROM 'array' OR jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR p_started_at IS NULL OR p_started_at > clock_timestamp() THEN RAISE EXCEPTION 'Invalid graph snapshot'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_sync_state WHERE notion_database_id = p_database AND last_success_at > p_started_at) THEN RAISE EXCEPTION 'Stale graph snapshot'; END IF;
  SELECT coalesce(array_agg(value::uuid), '{}') INTO ids FROM jsonb_array_elements_text(p_public_ids);
  DELETE FROM public.blog_post_links link USING public.blog_posts post
    WHERE link.source_id = post.id AND post.notion_database_id = p_database AND link.origin = 'notion_comment';
  INSERT INTO public.blog_post_links (source_id, target_id, origin)
  SELECT DISTINCT source.id, target.id, 'notion_comment'
  FROM jsonb_array_elements(p_links) edge JOIN public.blog_posts source ON source.id = (edge->>'source')::uuid
  JOIN public.blog_posts target ON target.id = (edge->>'target')::uuid
  WHERE source.id <> target.id AND source.notion_database_id = p_database AND target.notion_database_id = p_database
    AND source.id = ANY(ids) AND target.id = ANY(ids) AND source.is_published AND target.is_published
    AND source.sync_status = 'ready' AND target.sync_status = 'ready' AND source.deleted_at IS NULL AND target.deleted_at IS NULL ON CONFLICT DO NOTHING;
  UPDATE public.blog_sync_state SET last_success_at = clock_timestamp(), last_error = NULL, last_error_at = NULL WHERE notion_database_id = p_database;
END; $$;

REVOKE ALL ON FUNCTION public.blog_upsert_notion_book(uuid,jsonb,uuid[]), public.blog_store_webhook_verification(text),
  public.blog_enqueue_notion_event(uuid,text,text,uuid,timestamptz), public.blog_claim_notion_event(uuid,uuid), public.blog_assert_notion_lease(uuid,uuid,text),
  public.blog_finish_notion_event(uuid,uuid,text,boolean,text), public.blog_release_notion_worker(uuid,uuid), public.blog_retry_failed_notion_events(uuid),
  public.blog_commit_notion_page(uuid,uuid,text,uuid,timestamptz,jsonb,jsonb), public.blog_commit_notion_graph(uuid,uuid,text,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_upsert_notion_book(uuid,jsonb,uuid[]), public.blog_store_webhook_verification(text),
  public.blog_enqueue_notion_event(uuid,text,text,uuid,timestamptz), public.blog_claim_notion_event(uuid,uuid), public.blog_assert_notion_lease(uuid,uuid,text),
  public.blog_finish_notion_event(uuid,uuid,text,boolean,text), public.blog_release_notion_worker(uuid,uuid), public.blog_retry_failed_notion_events(uuid),
  public.blog_commit_notion_page(uuid,uuid,text,uuid,timestamptz,jsonb,jsonb), public.blog_commit_notion_graph(uuid,uuid,text,timestamptz,jsonb,jsonb)
  TO service_role;
COMMIT;
