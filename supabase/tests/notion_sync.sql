BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE blog_sync_fixture_ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
INSERT INTO blog_sync_fixture_ids (name) VALUES ('a'), ('b'), ('private'), ('source'), ('foreign'), ('foreign_source');
GRANT SELECT ON blog_sync_fixture_ids TO anon, service_role;
CREATE TEMP TABLE blog_sync_fixture_snapshot ON COMMIT DROP AS
SELECT jsonb_agg(jsonb_build_object(
  'post', jsonb_build_object('id', id, 'title', 'Sync fixture', 'author', '', 'category', '독서', 'tags', '[]'::jsonb,
    'kind', 'post', 'description', '', 'folder_path', '', 'written_at', now(), 'notion_created_at', now(), 'notion_edited_at', now()),
  'content', jsonb_build_object('record_map', jsonb_build_object('block', jsonb_build_object(id::text, jsonb_build_object('value', jsonb_build_object('id', id, 'type', 'page')))),
    'plain_text', 'Temporary fixture', 'reading_minutes', 0, 'source_edited_at', now(),
    'referenced_page_ids', CASE WHEN name = 'a' THEN (SELECT jsonb_build_array(id) FROM blog_sync_fixture_ids WHERE name = 'b') ELSE '[]'::jsonb END),
  'links', CASE WHEN name = 'a' THEN (SELECT jsonb_build_array(id) FROM blog_sync_fixture_ids WHERE name = 'b') ELSE '[]'::jsonb END
) ORDER BY name) AS books, public.blog_sync_started_at() AS started
FROM blog_sync_fixture_ids WHERE name IN ('a', 'b');
GRANT SELECT ON blog_sync_fixture_snapshot TO service_role;

SET LOCAL ROLE service_role;
SELECT public.blog_commit_notion_snapshot((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'),
  (SELECT started FROM blog_sync_fixture_snapshot), (SELECT books FROM blog_sync_fixture_snapshot));
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_sync_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'initial import failed'; END IF;
  IF (SELECT count(*) FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_sync_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'body import failed'; END IF;
  IF (SELECT count(*) FROM public.blog_post_links WHERE source_id IN (SELECT id FROM blog_sync_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'link import failed'; END IF;
END; $$;

SELECT public.blog_soft_delete_notion_post((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), (SELECT id FROM blog_sync_fixture_ids WHERE name = 'private'));
SELECT public.blog_soft_delete_notion_post((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), (SELECT id FROM blog_sync_fixture_ids WHERE name = 'b'));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE id = (SELECT id FROM blog_sync_fixture_ids WHERE name = 'private')) THEN RAISE EXCEPTION 'never-published page inserted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = (SELECT id FROM blog_sync_fixture_ids WHERE name = 'b') AND deleted_at IS NOT NULL AND NOT is_published) THEN RAISE EXCEPTION 'soft deletion missing'; END IF;
  IF (SELECT count(*) FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_sync_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'soft deletion destroyed body'; END IF;
  BEGIN
    PERFORM public.blog_commit_notion_snapshot((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), (SELECT started FROM blog_sync_fixture_snapshot), (SELECT books FROM blog_sync_fixture_snapshot));
    RAISE EXCEPTION 'stale snapshot accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Stale blog snapshot' THEN RAISE; END IF; END;
END; $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_sync_fixture_ids)) THEN RAISE EXCEPTION 'unpublished/dependent content still public'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_post_links WHERE source_id IN (SELECT id FROM blog_sync_fixture_ids)) THEN RAISE EXCEPTION 'unpublished link still public'; END IF;
  IF has_function_privilege(current_user, 'public.blog_commit_notion_snapshot(uuid,timestamptz,jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can write snapshot'; END IF;
END; $$;

SET LOCAL ROLE service_role;
SELECT public.blog_commit_notion_snapshot((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), public.blog_sync_started_at(), (SELECT books FROM blog_sync_fixture_snapshot));
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_sync_fixture_ids) AND is_published AND deleted_at IS NULL AND sync_status = 'ready') <> 2 THEN RAISE EXCEPTION 'republishing did not restore same rows'; END IF;
  BEGIN
    PERFORM public.blog_commit_notion_snapshot((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), public.blog_sync_started_at(),
      (SELECT jsonb_set(jsonb_set(books, '{0,post,title}', '"Partial edit"'), '{1,content,record_map}', '{}') FROM blog_sync_fixture_snapshot));
    RAISE EXCEPTION 'partial malformed snapshot accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Incomplete or mismatched blog body' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE id IN (SELECT id FROM blog_sync_fixture_ids) AND title = 'Partial edit') THEN RAISE EXCEPTION 'failed snapshot was not atomic'; END IF;
END; $$;

-- A complete catalog that now contains only A must soft-delete B.
SELECT public.blog_commit_notion_snapshot((SELECT id FROM blog_sync_fixture_ids WHERE name = 'source'), public.blog_sync_started_at(),
  (SELECT jsonb_build_array(jsonb_set(jsonb_set(books->0, '{links}', '[]'), '{content,referenced_page_ids}', '[]')) FROM blog_sync_fixture_snapshot));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.blog_posts WHERE id = (SELECT id FROM blog_sync_fixture_ids WHERE name = 'b') AND deleted_at IS NOT NULL AND NOT is_published) THEN RAISE EXCEPTION 'missing page not soft deleted'; END IF;
END; $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_sync_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'catalog revocation not enforced'; END IF;
END; $$;
RESET ROLE;
ROLLBACK;
