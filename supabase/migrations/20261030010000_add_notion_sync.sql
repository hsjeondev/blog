BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.blog_post_contents ADD COLUMN referenced_page_ids uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX blog_contents_references_idx ON public.blog_post_contents USING gin (referenced_page_ids);

CREATE FUNCTION public.blog_sync_started_at() RETURNS timestamptz
LANGUAGE sql SET search_path = pg_catalog AS $$ SELECT clock_timestamp(); $$;

-- A complete, freshly revalidated catalog is committed atomically. A failed or
-- partial Notion scan must never call this function with an incomplete snapshot.
CREATE FUNCTION public.blog_commit_notion_snapshot(p_database uuid, p_started_at timestamptz, p_books jsonb) RETURNS jsonb
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

-- Page-specific revocation never inserts a row for a never-published page.
CREATE FUNCTION public.blog_soft_delete_notion_post(p_database uuid, p_page uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE removed integer; dependent integer;
BEGIN
  IF p_database IS NULL OR p_page IS NULL THEN RAISE EXCEPTION 'Invalid blog page'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('blog-sync:' || p_database::text, 0));
  UPDATE public.blog_posts SET is_published = false, deleted_at = coalesce(deleted_at, now()), synced_at = now()
    WHERE notion_database_id = p_database AND id = p_page AND (is_published OR deleted_at IS NULL);
  GET DIAGNOSTICS removed = ROW_COUNT;
  -- Stored mentions can contain the target title. Hide those bodies until a
  -- fresh snapshot rebuilds them with the non-public mention removed.
  UPDATE public.blog_posts post SET sync_status = 'pending'
    WHERE post.notion_database_id = p_database AND post.is_published AND post.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.blog_post_contents body WHERE body.post_id = post.id AND p_page = ANY(body.referenced_page_ids));
  GET DIAGNOSTICS dependent = ROW_COUNT;
  INSERT INTO public.blog_sync_state (notion_database_id, last_success_at) VALUES (p_database, clock_timestamp())
  ON CONFLICT (notion_database_id) DO UPDATE SET last_success_at = excluded.last_success_at;
  RETURN jsonb_build_object('softDeleted', removed, 'dependentPending', dependent);
END; $$;

CREATE FUNCTION public.blog_note_sync_failure(p_database uuid, p_error text) RETURNS void
LANGUAGE sql SET search_path = pg_catalog AS $$
  INSERT INTO public.blog_sync_state (notion_database_id, last_error_at, last_error) VALUES (p_database, now(), left(p_error, 500))
  ON CONFLICT (notion_database_id) DO UPDATE SET last_error_at = excluded.last_error_at, last_error = excluded.last_error;
$$;

REVOKE ALL ON FUNCTION public.blog_sync_started_at(), public.blog_commit_notion_snapshot(uuid, timestamptz, jsonb),
  public.blog_soft_delete_notion_post(uuid, uuid), public.blog_note_sync_failure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_sync_started_at(), public.blog_commit_notion_snapshot(uuid, timestamptz, jsonb),
  public.blog_soft_delete_notion_post(uuid, uuid), public.blog_note_sync_failure(uuid, text) TO service_role;
COMMIT;
