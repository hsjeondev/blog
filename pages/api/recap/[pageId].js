import { getNotionPage, isNotionNotFound } from '../../../utils/get-notion-page';
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
    let narration = { pageId, status: "unavailable", blocks: {} };
    if (process.env.AUDIO_SERVER_URL) {
      const narrationUrl = `${process.env.AUDIO_SERVER_URL.replace(/\/$/, "")}/v1/pages/${pageId}/manifest`;
      try {
        const response = await fetch(narrationUrl, {
          signal: AbortSignal.timeout(2500),
        });
        if (response.ok) {
          narration = await response.json();
        } else {
          console.warn(`Narration manifest responded ${response.status} for ${pageId} from ${new URL(narrationUrl).origin}`);
        }
      } catch (error) {
        const cause = error?.cause;
        console.error("Narration manifest fetch failed", {
          pageId,
          origin: new URL(narrationUrl).origin,
          name: error?.name,
          message: error?.message,
          cause: cause instanceof Error
            ? { name: cause.name, message: cause.message, code: cause.code, errno: cause.errno, syscall: cause.syscall, hostname: cause.hostname, address: cause.address, port: cause.port }
            : cause,
        });
      }
    }

    return res.status(200).json({ ...recap, narration });
  } catch (error) {
    if (!isNotionNotFound(error)) console.error("Failed to fetch recap page");
    return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: "Failed to fetch recap page" });
  }
}
