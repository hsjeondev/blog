BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE blog_read_fixture_ids (name text PRIMARY KEY,id uuid NOT NULL DEFAULT gen_random_uuid()) ON COMMIT DROP;
INSERT INTO blog_read_fixture_ids(name) VALUES ('source'),('public'),('private'),('media_pending'),('foreign');
GRANT SELECT ON blog_read_fixture_ids TO anon, service_role;
INSERT INTO public.blog_posts(id,notion_database_id,title,written_at,notion_created_at,notion_edited_at,is_published,sync_status,assets_ready)
SELECT post.id,source.id,'Fixture '||post.name,now(),now(),now(),post.name<>'private','ready',post.name<>'media_pending'
FROM blog_read_fixture_ids post CROSS JOIN blog_read_fixture_ids source WHERE source.name='source' AND post.name IN ('public','private','media_pending');
INSERT INTO public.blog_post_contents(post_id,record_map,plain_text,source_edited_at,reading_minutes)
SELECT id,jsonb_build_object('block',jsonb_build_object(id::text,jsonb_build_object('value',jsonb_build_object('id',id,'type','page')))),
  CASE WHEN name='public' THEN '내 책 독서 기록, 기호 %_ 검색' ELSE 'PRIVATE_SEARCH_TEXT' END,now(),3
FROM blog_read_fixture_ids WHERE name IN ('public','private','media_pending');
INSERT INTO public.blog_assets(post_id,asset_key,object_path,content_hash,content_type,byte_size)
SELECT id,repeat('a',64),id::text||'/'||repeat('b',64),repeat('b',64),'image/png',8 FROM blog_read_fixture_ids WHERE name IN ('public','private','media_pending');
INSERT INTO public.blog_post_links(source_id,target_id)
SELECT source.id,target.id FROM blog_read_fixture_ids source CROSS JOIN blog_read_fixture_ids target WHERE source.name='public' AND target.name IN ('private','media_pending');
SET LOCAL ROLE service_role;
DO $$ DECLARE source uuid; page uuid; hidden uuid; pending uuid; data jsonb; BEGIN
  SELECT id INTO source FROM blog_read_fixture_ids WHERE name='source';
  SELECT id INTO page FROM blog_read_fixture_ids WHERE name='public';
  SELECT id INTO hidden FROM blog_read_fixture_ids WHERE name='private';
  SELECT id INTO pending FROM blog_read_fixture_ids WHERE name='media_pending';
  IF jsonb_array_length(public.blog_read_catalog(source))<>1 THEN RAISE EXCEPTION 'privileged catalog leaked hidden/media-pending rows'; END IF;
  IF public.blog_read_page(source,hidden) IS NOT NULL OR public.blog_read_page(source,pending) IS NOT NULL THEN RAISE EXCEPTION 'privileged body read bypassed visibility'; END IF;
  data:=public.blog_read_page(source,page);
  IF data->>'readingMinutes'<>'3' THEN RAISE EXCEPTION 'stored read time not returned'; END IF;
  IF jsonb_array_length(public.blog_read_graph(source)->'links')<>0 THEN RAISE EXCEPTION 'graph exposed a hidden endpoint'; END IF;
  IF jsonb_array_length(public.blog_search_public(source,'독서',jsonb_build_array(page,hidden,pending)))<>1 THEN RAISE EXCEPTION 'body search failed'; END IF;
  IF jsonb_array_length(public.blog_search_public(source,'%_',jsonb_build_array(page)))<>1 THEN RAISE EXCEPTION 'search wildcard characters were not literal'; END IF;
  IF jsonb_array_length(public.blog_search_public(source,'PRIVATE_SEARCH_TEXT',jsonb_build_array(page,hidden,pending)))<>0 THEN RAISE EXCEPTION 'search leaked private text'; END IF;
  IF public.blog_read_asset(source,hidden,repeat('a',64)) IS NOT NULL OR public.blog_read_asset(source,pending,repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION 'privileged media read bypassed publication'; END IF;
  IF public.blog_read_asset(source,page,repeat('a',64)) IS NULL THEN RAISE EXCEPTION 'public asset inaccessible'; END IF;
  IF jsonb_array_length(public.blog_read_catalog((SELECT id FROM blog_read_fixture_ids WHERE name='foreign')))<>0 THEN RAISE EXCEPTION 'source boundary bypassed'; END IF;
END; $$;
SET LOCAL ROLE anon;
DO $$ DECLARE source uuid; page uuid; BEGIN
  SELECT id INTO source FROM blog_read_fixture_ids WHERE name='source';
  SELECT id INTO page FROM blog_read_fixture_ids WHERE name='public';
  IF jsonb_array_length(public.blog_read_catalog(source))<>1 THEN RAISE EXCEPTION 'anon catalog visibility incorrect'; END IF;
  IF (SELECT count(*) FROM public.blog_assets WHERE post_id IN (SELECT id FROM blog_read_fixture_ids))<>1 THEN RAISE EXCEPTION 'anon can read non-public assets'; END IF;
  IF has_function_privilege(current_user,'public.blog_sync_asset_cache(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon can inspect sync assets'; END IF;
END; $$;
SET LOCAL ROLE service_role;
UPDATE public.blog_posts SET is_published=false,deleted_at=now() WHERE id=(SELECT id FROM blog_read_fixture_ids WHERE name='public');
DO $$ DECLARE source uuid; page uuid; BEGIN
  SELECT id INTO source FROM blog_read_fixture_ids WHERE name='source';
  SELECT id INTO page FROM blog_read_fixture_ids WHERE name='public';
  IF public.blog_read_asset(source,page,repeat('a',64)) IS NOT NULL OR public.blog_read_page(source,page) IS NOT NULL THEN RAISE EXCEPTION 'soft delete did not revoke body and media'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.blog_assets WHERE post_id=page) OR NOT EXISTS (SELECT 1 FROM public.blog_post_contents WHERE post_id=page) THEN RAISE EXCEPTION 'soft delete destroyed stored data'; END IF;
END; $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT public FROM storage.buckets WHERE id='blog-assets') THEN RAISE EXCEPTION 'storage bucket is public'; END IF;
END; $$;
SELECT 'database_reads_and_media_visibility_verified' AS result;
ROLLBACK;
