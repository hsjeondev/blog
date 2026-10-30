import { noPublicationCache } from "../../utils/notion-server";
import type { NextApiRequest, NextApiResponse } from "next";
import { searchContent } from "../../utils/search/search-service";
import { isSearchScope } from "../../utils/search/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const { q = "", type = "all", folder = "", mode = "metadata", cursor = "" } = req.query;
  if (typeof q !== "string" || q.length > 300 || !isSearchScope(type) || typeof folder !== "string" || folder.length > 500
      || !['metadata', 'body'].includes(mode as string) || typeof cursor !== 'string' || cursor.length > 500) {
    return res.status(400).json({ error: "검색 조건을 확인해 주세요." });
  }
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  req.once?.('aborted', disconnect);
  res.once?.('close', disconnect);
  if (req.aborted) controller.abort();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(mode === 'body' ? 12_000 : 8_000)]);
  try {
    const result = await searchContent(q, type, folder, 50, { mode: mode as 'metadata' | 'body', cursor, signal });
    signal.throwIfAborted();
    return res.status(200).json(result);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error.status === 400) return res.status(400).json({ error: '검색 조건을 확인해 주세요.' });
    return res.status(502).json({ error: "검색을 불러오지 못했습니다. 다시 시도해 주세요." });
  } finally {
    req.off?.('aborted', disconnect);
    res.off?.('close', disconnect);
  }
}
