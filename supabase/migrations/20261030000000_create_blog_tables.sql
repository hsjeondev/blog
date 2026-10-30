-- Blog storage only. Existing public tables and their policies are untouched.
-- Apply once using a database administrator / Supabase SQL Editor.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY, -- Original Notion page ID; existing URLs stay usable.
  notion_database_id uuid NOT NULL,
  title text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '독서',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'document', 'project', 'recap')),
  description text NOT NULL DEFAULT '',
  folder_path text NOT NULL DEFAULT '',
  icon jsonb,
  cover jsonb,
  written_at timestamptz NOT NULL,
  notion_created_at timestamptz NOT NULL,
  notion_edited_at timestamptz NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  sync_status text NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'ready', 'failed')),
  synced_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX blog_posts_public_date_idx ON public.blog_posts (written_at DESC, id)
  WHERE is_published AND sync_status = 'ready' AND deleted_at IS NULL;
CREATE INDEX blog_posts_source_idx ON public.blog_posts (notion_database_id);

CREATE TABLE public.blog_post_contents (
  post_id uuid PRIMARY KEY REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  record_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(record_map) = 'object'),
  plain_text text NOT NULL DEFAULT '',
  reading_minutes integer NOT NULL DEFAULT 0 CHECK (reading_minutes >= 0),
  source_edited_at timestamptz NOT NULL,
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version > 0),
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.blog_post_links (
  source_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  origin text NOT NULL DEFAULT 'notion_comment' CHECK (origin IN ('notion_comment', 'manual')),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, target_id, origin),
  CHECK (source_id <> target_id)
);
CREATE INDEX blog_post_links_target_idx ON public.blog_post_links (target_id, source_id);

CREATE TABLE public.blog_sync_events (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 200),
  event_type text NOT NULL,
  entity_id uuid,
  notion_database_id uuid,
  event_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blog_sync_events_pending_idx ON public.blog_sync_events (available_at, received_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX blog_sync_events_locked_idx ON public.blog_sync_events (locked_at)
  WHERE status = 'processing';

CREATE TABLE public.blog_sync_state (
  notion_database_id uuid PRIMARY KEY,
  last_full_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.blog_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
  AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.blog_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_touch_updated_at() TO service_role;

CREATE TRIGGER blog_posts_updated_at BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.blog_touch_updated_at();
CREATE TRIGGER blog_sync_events_updated_at BEFORE UPDATE ON public.blog_sync_events
  FOR EACH ROW EXECUTE FUNCTION public.blog_touch_updated_at();
CREATE TRIGGER blog_sync_state_updated_at BEFORE UPDATE ON public.blog_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.blog_touch_updated_at();

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_post_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_sync_state ENABLE ROW LEVEL SECURITY;

-- Explicit grants override Supabase's default table grants for these five tables.
REVOKE ALL ON TABLE public.blog_posts, public.blog_post_contents, public.blog_post_links,
  public.blog_sync_events, public.blog_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.blog_posts, public.blog_post_contents, public.blog_post_links TO anon, authenticated;
GRANT ALL ON TABLE public.blog_posts, public.blog_post_contents, public.blog_post_links,
  public.blog_sync_events, public.blog_sync_state TO service_role;

CREATE POLICY blog_posts_public_read ON public.blog_posts FOR SELECT TO anon, authenticated
  USING (is_published AND sync_status = 'ready' AND deleted_at IS NULL);
CREATE POLICY blog_contents_public_read ON public.blog_post_contents FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id = post_id
    AND post.is_published AND post.sync_status = 'ready' AND post.deleted_at IS NULL));
CREATE POLICY blog_links_public_read ON public.blog_post_links FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id = source_id
    AND post.is_published AND post.sync_status = 'ready' AND post.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.blog_posts post WHERE post.id = target_id
    AND post.is_published AND post.sync_status = 'ready' AND post.deleted_at IS NULL));
-- No public policies on the event inbox and sync state: service-role access only.

COMMENT ON TABLE public.blog_posts IS 'Blog metadata; public reads require publication, ready sync status, and no deletion.';
COMMENT ON TABLE public.blog_post_contents IS 'Materialized renderer blocks and search text; read only through a public parent post.';
COMMENT ON TABLE public.blog_post_links IS 'Book connections only. Never store Notion comment text or authors here.';
COMMENT ON TABLE public.blog_sync_events IS 'Private webhook inbox with event deduplication and retry state. No comment bodies or credentials.';
COMMENT ON TABLE public.blog_sync_state IS 'Private synchronization checkpoints for each Notion database.';

COMMIT;
