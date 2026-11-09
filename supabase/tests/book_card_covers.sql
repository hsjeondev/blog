BEGIN;
DO $$
DECLARE
  page_id uuid := '11111111-1111-4111-8111-111111111111';
  own_url text := '/api/blog-media/11111111-1111-4111-8111-111111111111/' || repeat('a', 64);
  foreign_url text := '/api/blog-media/22222222-2222-4222-8222-222222222222/' || repeat('b', 64);
  map jsonb;
BEGIN
  map := jsonb_build_object('block', jsonb_build_object(
    page_id::text, jsonb_build_object('value', jsonb_build_object('content', jsonb_build_array('foreign', 'own'))),
    'foreign', jsonb_build_object('value', jsonb_build_object('type', 'image', 'properties', jsonb_build_object('source', jsonb_build_array(jsonb_build_array(foreign_url))))),
    'own', jsonb_build_object('value', jsonb_build_object('type', 'image', 'properties', jsonb_build_object('source', jsonb_build_array(jsonb_build_array(own_url)))))
  ));
  IF public.blog_card_cover(map, page_id) IS DISTINCT FROM own_url THEN
    RAISE EXCEPTION 'A card cover must use only this page''s mirrored image';
  END IF;
  map := jsonb_set(map, ARRAY['block', 'own', 'value', 'properties', 'source'], '[["https://example.com/expiring-image"]]');
  IF public.blog_card_cover(map, page_id) IS NOT NULL THEN
    RAISE EXCEPTION 'External, signed or foreign image URLs must not enter card metadata';
  END IF;
  IF public.blog_card_cover('{}', page_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Pages without images must keep the fallback';
  END IF;
END;
$$;
ROLLBACK;
