import { getPublishedPage } from '../../../utils/blog-data';
import { isNotionNotFound } from '../../../utils/blog-data';
import { noPublicationCache } from '../../../utils/notion-server';
export default async function handler(req, res) {
  noPublicationCache(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const pageId = Array.isArray(req.query.pageId) ? req.query.pageId[0] : req.query.pageId;
  if (!pageId?.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
    return res.status(400).json({ error: "Invalid page id" });
  }
  try { await getPublishedPage(pageId); }
  catch (error) { return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'Document unavailable' }); }
  if (!process.env.AUDIO_SERVER_URL) {
    return res.status(503).json({ error: "Narration server is not configured" });
  }

  const origin = process.env.AUDIO_SERVER_URL.replace(/\/$/, "");
  try {
    const response = await fetch(`${origin}/v1/pages/${pageId}/manifest`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Narration manifest unavailable" });
    }
    const manifest = await response.json();

    return res.status(200).json(manifest);
  } catch (error) {
    console.error("Post narration manifest fetch failed", { pageId, message: error?.message });
    return res.status(502).json({ error: "Narration manifest fetch failed" });
  }
}
