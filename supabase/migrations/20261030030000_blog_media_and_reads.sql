BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('blog-assets','blog-assets',false,20971520,ARRAY['image/*','audio/*','video/*','application/pdf','application/octet-stream','application/zip','application/epub+zip','text/plain'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF (SELECT public FROM storage.buckets WHERE id='blog-assets') THEN RAISE EXCEPTION 'Blog asset bucket must be private'; END IF;
END; $$;
ALTER TABLE public.blog_posts ADD COLUMN assets_ready boolean NOT NULL DEFAULT false;
CREATE TABLE public.blog_assets (
  post_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  asset_key text NOT NULL CHECK (asset_key ~ '^[a-f0-9]{64}$'),
  object_path text NOT NULL CHECK (object_path ~ '^[a-f0-9-]{36}/[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id,asset_key),
  CHECK (split_part(object_path,'/',1)=post_id::text)
);
ALTER TABLE public.blog_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blog_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.blog_assets TO anon, authenticated;
GRANT ALL ON public.blog_assets TO service_role;
ALTER POLICY blog_posts_public_read ON public.blog_posts USING (is_published AND sync_status='ready' AND deleted_at IS NULL AND assets_ready);
ALTER POLICY blog_contents_public_read ON public.blog_post_contents USING (EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id=post_id AND post.is_published AND post.sync_status='ready' AND post.deleted_at IS NULL AND post.assets_ready));
ALTER POLICY blog_links_public_read ON public.blog_post_links USING (
  EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id=source_id AND post.is_published AND post.sync_status='ready' AND post.deleted_at IS NULL AND post.assets_ready)
  AND EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id=target_id AND post.is_published AND post.sync_status='ready' AND post.deleted_at IS NULL AND post.assets_ready));
CREATE POLICY blog_assets_public_read ON public.blog_assets FOR SELECT TO anon, authenticated
USING (EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id=post_id AND post.is_published AND post.sync_status='ready' AND post.deleted_at IS NULL AND post.assets_ready));

CREATE OR REPLACE FUNCTION public.blog_upsert_notion_book(p_database uuid, item jsonb, ids uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE refs uuid[];
BEGIN
  IF jsonb_typeof(item->'assets') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Asset mirror required'; END IF;
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
  DELETE FROM public.blog_assets WHERE post_id = (item->'post'->>'id')::uuid
    AND asset_key NOT IN (SELECT asset->>'asset_key' FROM jsonb_array_elements(item->'assets') asset);
  INSERT INTO public.blog_assets (post_id,asset_key,object_path,content_hash,content_type,byte_size)
  SELECT (item->'post'->>'id')::uuid, asset.asset_key, asset.object_path, asset.content_hash, asset.content_type, asset.byte_size
  FROM jsonb_to_recordset(item->'assets') AS asset(asset_key text,object_path text,content_hash text,content_type text,byte_size bigint)
  ON CONFLICT (post_id,asset_key) DO UPDATE SET object_path=excluded.object_path, content_hash=excluded.content_hash,
    content_type=excluded.content_type, byte_size=excluded.byte_size, synced_at=now();
  UPDATE public.blog_posts SET assets_ready=true WHERE id=(item->'post'->>'id')::uuid;
END; $$;

CREATE FUNCTION public.blog_visible_posts(p_database uuid) RETURNS SETOF public.blog_posts
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT * FROM public.blog_posts WHERE notion_database_id=p_database AND is_published AND sync_status='ready' AND deleted_at IS NULL AND assets_ready;
$$;
CREATE FUNCTION public.blog_read_catalog(p_database uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(post) ORDER BY written_at DESC, notion_created_at DESC, id),'[]') FROM public.blog_visible_posts(p_database) post;
$$;
CREATE FUNCTION public.blog_read_post(p_database uuid,p_page uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT to_jsonb(post) FROM public.blog_visible_posts(p_database) post WHERE id=p_page;
$$;
CREATE FUNCTION public.blog_read_page(p_database uuid,p_page uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('post',to_jsonb(post),'recordMap',body.record_map,'readingMinutes',body.reading_minutes,
    'references',(SELECT coalesce(jsonb_agg(to_jsonb(target)),'[]') FROM public.blog_visible_posts(p_database) target WHERE target.id=ANY(body.referenced_page_ids)))
  FROM public.blog_visible_posts(p_database) post JOIN public.blog_post_contents body ON body.post_id=post.id
  WHERE post.id=p_page AND body.source_edited_at=post.notion_edited_at;
$$;
CREATE FUNCTION public.blog_read_graph(p_database uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  WITH visible AS MATERIALIZED (SELECT * FROM public.blog_visible_posts(p_database))
  SELECT jsonb_build_object('posts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'kind',kind)),'[]') FROM visible),
    'links',(SELECT coalesce(jsonb_agg(jsonb_build_object('source',link.source_id,'target',link.target_id,'kind','reference')),'[]')
      FROM public.blog_post_links link JOIN visible source ON source.id=link.source_id JOIN visible target ON target.id=link.target_id));
$$;
CREATE FUNCTION public.blog_search_public(p_database uuid,p_query text,p_ids jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  WITH matches AS (
    SELECT post.id, post.notion_edited_at, post.written_at, body.plain_text,
      strpos(lower(normalize(body.plain_text,NFKC)),lower(normalize(p_query,NFKC))) AS position
    FROM public.blog_visible_posts(p_database) post JOIN public.blog_post_contents body ON body.post_id=post.id
    WHERE body.source_edited_at=post.notion_edited_at AND char_length(trim(p_query)) BETWEEN 1 AND 300
      AND post.id IN (SELECT value::uuid FROM jsonb_array_elements_text(p_ids))
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',notion_edited_at,'excerpt',substring(plain_text FROM greatest(1,position-60) FOR 240))),'[]')
  FROM (SELECT * FROM matches WHERE position>0 ORDER BY written_at DESC,id LIMIT 50) found;
$$;
CREATE FUNCTION public.blog_read_asset(p_database uuid,p_page uuid,p_asset text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT to_jsonb(asset) FROM public.blog_assets asset JOIN public.blog_visible_posts(p_database) post ON post.id=asset.post_id
  WHERE post.id=p_page AND asset.asset_key=p_asset;
$$;
CREATE FUNCTION public.blog_sync_asset_cache(p_database uuid,p_page uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(asset)),'[]') FROM public.blog_assets asset JOIN public.blog_posts post ON post.id=asset.post_id
  JOIN storage.objects object ON object.bucket_id='blog-assets' AND object.name=asset.object_path
  WHERE post.notion_database_id=p_database AND post.id=p_page;
$$;
REVOKE ALL ON FUNCTION public.blog_visible_posts(uuid), public.blog_read_catalog(uuid), public.blog_read_post(uuid,uuid), public.blog_read_page(uuid,uuid),
  public.blog_read_graph(uuid), public.blog_search_public(uuid,text,jsonb), public.blog_read_asset(uuid,uuid,text), public.blog_sync_asset_cache(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blog_visible_posts(uuid), public.blog_read_catalog(uuid), public.blog_read_post(uuid,uuid), public.blog_read_page(uuid,uuid),
  public.blog_read_graph(uuid), public.blog_search_public(uuid,text,jsonb), public.blog_read_asset(uuid,uuid,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.blog_sync_asset_cache(uuid,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_sync_asset_cache(uuid,uuid) TO service_role;
COMMENT ON TABLE public.blog_assets IS 'Private bucket files referenced by published posts. Proxy routes recheck publication on every request.';
COMMIT;
