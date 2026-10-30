import { useEffect, useRef, useState } from "react";
import { searchKey, type SearchSnapshot } from "../utils/search/result-cache";
import type { SearchResult, SearchScope } from "../utils/search/types";

const EMPTY: SearchSnapshot = { results: [], partial: false };
const IDLE = { loading: false, error: '', scanned: 0, total: 0, stopped: false };

export function useSearchResults(query: string, scope: SearchScope, folder: string) {
  const [response, setResponse] = useState<{ key: string; snapshot: SearchSnapshot } | null>(null);
  const [status, setStatus] = useState({ key: "", loading: false, error: "" });
  const [body, setBody] = useState(IDLE);
  const bodyController = useRef<AbortController | null>(null);
  const trimmed = query.trim();
  const key = searchKey(trimmed, scope, folder);
  const snapshot = trimmed && response?.key === key ? response.snapshot : EMPTY;

  useEffect(() => {
    const controller = new AbortController();
    bodyController.current?.abort();
    setBody(IDLE);
    setResponse(null);
    setStatus({ key, loading: !!trimmed, error: "" });
    if (!trimmed) return () => controller.abort();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, type: scope, folder });
        const result = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || "검색에 실패했습니다.");
        if (controller.signal.aborted) return;
        setResponse({ key, snapshot: { results: data.results, partial: false } });
        setStatus({ key, loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setStatus({ key, loading: false, error: error.message || "검색에 실패했습니다." });
      }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); bodyController.current?.abort(); };
  }, [trimmed, scope, folder, key]);

  const searchBody = async () => {
    if (!trimmed || body.loading) return;
    bodyController.current?.abort();
    const controller = new AbortController();
    bodyController.current = controller;
    setBody({ ...IDLE, loading: true });
    let cursor = '';
    let combined = snapshot.results;
    let partial = false;
    try {
      do {
        const params = new URLSearchParams({ q: trimmed, type: scope, folder, mode: 'body', cursor });
        const result = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || '본문 검색을 불러오지 못했습니다.');
        if (controller.signal.aborted) return;
        const current = new Map<string, SearchResult>(combined.filter(item => data.live?.[item.id] === item.lastEditedTime).map(item => [item.id, item]));
        for (const item of data.results) current.set(item.id, item);
        combined = [...current.values()];
        partial ||= !!data.partial;
        setResponse({ key, snapshot: { results: combined, partial } });
        setBody({ ...IDLE, loading: !!data.nextCursor, scanned: data.scanned, total: data.total });
        cursor = data.nextCursor || '';
      } while (cursor);
    } catch (error) {
      if (!controller.signal.aborted) setBody(previous => ({ ...previous, loading: false, error: '본문 검색을 완료하지 못했습니다. 기존 검색 결과는 유지됩니다.' }));
    } finally {
      if (bodyController.current === controller) bodyController.current = null;
    }
  };
  const stopBody = () => {
    bodyController.current?.abort();
    setBody(previous => ({ ...previous, loading: false, stopped: true }));
  };
  return {
    ...snapshot, body, searchBody, stopBody,
    loading: !!trimmed && (status.key !== key || status.loading),
    error: status.key === key ? status.error : "",
  };
}
