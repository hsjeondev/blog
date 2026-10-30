-- Run after the migration. All fixtures and role changes roll back.
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE blog_fixture_ids (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
INSERT INTO blog_fixture_ids (name) VALUES ('public_a'), ('public_b'), ('private'), ('pending'), ('failed'), ('deleted'), ('source'), ('event');
GRANT SELECT ON blog_fixture_ids TO anon, authenticated, service_role;

INSERT INTO public.blog_posts (id, notion_database_id, title, written_at, notion_created_at, notion_edited_at, is_published, sync_status, deleted_at)
SELECT fixture.id, source.id, 'Schema test: ' || fixture.name, now(), now(), now(),
       fixture.name <> 'private',
       CASE WHEN fixture.name = 'pending' THEN 'pending' WHEN fixture.name = 'failed' THEN 'failed' ELSE 'ready' END,
       CASE WHEN fixture.name = 'deleted' THEN now() END
FROM blog_fixture_ids fixture CROSS JOIN blog_fixture_ids source
WHERE source.name = 'source' AND fixture.name NOT IN ('source', 'event');

UPDATE public.blog_posts SET assets_ready=true WHERE id IN (SELECT id FROM blog_fixture_ids);

INSERT INTO public.blog_post_contents (post_id, record_map, plain_text, source_edited_at)
SELECT id, '{"block":{}}'::jsonb, 'Temporary access-policy fixture', now()
FROM blog_fixture_ids WHERE name NOT IN ('source', 'event');

INSERT INTO public.blog_post_links (source_id, target_id)
SELECT source.id, target.id FROM blog_fixture_ids source CROSS JOIN blog_fixture_ids target
WHERE (source.name, target.name) IN (('public_a', 'public_b'), ('public_a', 'private'), ('private', 'public_a'), ('pending', 'public_a'), ('deleted', 'public_a'));

INSERT INTO public.blog_sync_events (event_id, event_type, entity_id, event_time)
SELECT event.id::text, 'page.updated', post.id, now() FROM blog_fixture_ids event CROSS JOIN blog_fixture_ids post
WHERE event.name = 'event' AND post.name = 'public_a';
INSERT INTO public.blog_sync_state (notion_database_id) SELECT id FROM blog_fixture_ids WHERE name = 'source';

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'anon can see a private, deleted, incomplete or failed post'; END IF;
  IF (SELECT count(*) FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'anon body visibility differs from posts'; END IF;
  IF (SELECT count(*) FROM public.blog_post_links WHERE source_id IN (SELECT id FROM blog_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'anon can see a link with a non-public endpoint'; END IF;
  IF has_table_privilege(current_user, 'public.blog_posts', 'INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'anon has write permissions'; END IF;
  BEGIN UPDATE public.blog_posts SET title = 'Unexpected write' WHERE id IN (SELECT id FROM blog_fixture_ids); RAISE EXCEPTION 'anon write unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.blog_sync_events; RAISE EXCEPTION 'anon can read event inbox'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.blog_sync_state; RAISE EXCEPTION 'anon can read sync state'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'authenticated can see non-public posts'; END IF;
  IF (SELECT count(*) FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_fixture_ids)) <> 2 THEN RAISE EXCEPTION 'authenticated can see non-public bodies'; END IF;
  IF (SELECT count(*) FROM public.blog_post_links WHERE source_id IN (SELECT id FROM blog_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'authenticated can see non-public links'; END IF;
  IF has_table_privilege(current_user, 'public.blog_posts', 'INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'authenticated has write permissions'; END IF;
  BEGIN PERFORM 1 FROM public.blog_sync_events; RAISE EXCEPTION 'authenticated can read event inbox'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.blog_sync_state; RAISE EXCEPTION 'authenticated can read sync state'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;

SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_posts WHERE id IN (SELECT id FROM blog_fixture_ids)) <> 6 THEN RAISE EXCEPTION 'sync service cannot access its private fixtures'; END IF;
  IF (SELECT count(*) FROM public.blog_sync_events WHERE event_id IN (SELECT id::text FROM blog_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'sync service cannot read event inbox'; END IF;
  UPDATE public.blog_posts SET title = 'Updated fixture', updated_at = '2000-01-01' WHERE id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a');
  IF EXISTS (SELECT 1 FROM public.blog_posts WHERE id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a') AND updated_at <> now()) THEN RAISE EXCEPTION 'updated_at trigger did not run'; END IF;
  BEGIN
    INSERT INTO public.blog_sync_events (event_id, event_type, event_time) SELECT id::text, 'duplicate', now() FROM blog_fixture_ids WHERE name = 'event';
    RAISE EXCEPTION 'duplicate webhook event unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.blog_posts SET is_published = false WHERE id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a');
END; $$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.blog_post_contents WHERE post_id IN (SELECT id FROM blog_fixture_ids)) <> 1 THEN RAISE EXCEPTION 'unpublishing did not hide body'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_post_links WHERE source_id IN (SELECT id FROM blog_fixture_ids)) THEN RAISE EXCEPTION 'unpublishing did not hide links'; END IF;
END; $$;

SET LOCAL ROLE service_role;
DELETE FROM public.blog_posts WHERE id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.blog_post_contents WHERE post_id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a')) THEN RAISE EXCEPTION 'delete left an orphan body'; END IF;
  IF EXISTS (SELECT 1 FROM public.blog_post_links WHERE source_id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a') OR target_id = (SELECT id FROM blog_fixture_ids WHERE name = 'public_a')) THEN RAISE EXCEPTION 'delete left orphan links'; END IF;
END; $$;
RESET ROLE;
ROLLBACK;
