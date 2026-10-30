import { getNotionPage, isNotionNotFound } from '../../../utils/blog-data';
import { noPublicationCache } from '../../../utils/notion-server';
import { prepareRecapRecordMap } from "../../../utils/recap-record-map";

export default async function handler(req, res) {
  noPublicationCache(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const pageId = Array.isArray(req.query.pageId) ? req.query.pageId[0] : req.query.pageId;
  if (!pageId?.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
    return res.status(400).json({ error: "Invalid page id" });
  }
  try {
    const recap = prepareRecapRecordMap(await getNotionPage(pageId), pageId);
    return res.status(200).json(recap);
  } catch (error) {
    if (!isNotionNotFound(error)) console.error("Failed to fetch recap page");
    return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: "Failed to fetch recap page" });
  }
}
