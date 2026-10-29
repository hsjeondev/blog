import { noPublicationCache } from "../../utils/notion-server";
import type { NextApiRequest, NextApiResponse } from "next";
import { searchContent } from "../../utils/search/search-service";
import { isSearchScope } from "../../utils/search/types";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const { q = "", type = "all", folder = "" } = req.query;
  if (typeof q !== "string" || q.length > 300 || !isSearchScope(type) || typeof folder !== "string" || folder.length > 500) {
    return res.status(400).json({ error: "검색 조건을 확인해 주세요." });
  }
  try {
    const result = await searchContent(q, type, folder);

    return res.status(200).json(result);
  } catch {
    return res.status(502).json({ error: "검색을 불러오지 못했습니다. 다시 시도해 주세요." });
  }
}
