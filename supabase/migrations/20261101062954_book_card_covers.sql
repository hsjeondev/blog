SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.blog_posts ADD COLUMN card_cover text;
ALTER TABLE public.blog_posts ADD CONSTRAINT blog_card_cover_own_media CHECK (
  card_cover IS NULL OR card_cover ~ ('^/api/blog-media/' || id::text || '/[a-f0-9]{64}$')
);

-- Select only the page's own, ordered top-level images. The stored body already
-- contains mirrored proxy URLs, never expose expiring Notion or Storage URLs.
CREATE FUNCTION public.blog_card_cover(map jsonb, page_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT map #>> ARRAY['block', child.id, 'value', 'properties', 'source', '0', '0']
  FROM jsonb_array_elements_text(coalesce(map #> ARRAY['block', page_id::text, 'value', 'content'], '[]'::jsonb))
    WITH ORDINALITY AS child(id, position)
  WHERE map #>> ARRAY['block', child.id, 'value', 'type'] = 'image'
    AND (map #>> ARRAY['block', child.id, 'value', 'properties', 'source', '0', '0'])
      ~ ('^/api/blog-media/' || page_id::text || '/[a-f0-9]{64}$')
  ORDER BY child.position LIMIT 1;
$$;

CREATE FUNCTION public.blog_update_card_cover() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE next_cover text;
BEGIN
  next_cover := public.blog_card_cover(NEW.record_map, NEW.post_id);
  UPDATE public.blog_posts SET card_cover = next_cover
  WHERE id = NEW.post_id AND card_cover IS DISTINCT FROM next_cover;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.blog_card_cover(jsonb, uuid), public.blog_update_card_cover() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blog_card_cover(jsonb, uuid), public.blog_update_card_cover() TO service_role;

CREATE TRIGGER blog_content_card_cover
AFTER INSERT OR UPDATE OF record_map ON public.blog_post_contents
FOR EACH ROW EXECUTE FUNCTION public.blog_update_card_cover();

UPDATE public.blog_posts post SET card_cover = public.blog_card_cover(body.record_map, post.id)
FROM public.blog_post_contents body
WHERE body.post_id = post.id
  AND post.card_cover IS DISTINCT FROM public.blog_card_cover(body.record_map, post.id);

COMMENT ON COLUMN public.blog_posts.card_cover IS 'Mirrored first body image for book cards; independent of the Notion page cover. Updated with each body snapshot.';
