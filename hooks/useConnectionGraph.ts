import { useEffect, useState } from 'react';
import { mergeGraphBatch, type GraphBatch } from '../utils/connection-graph';
import type { GraphData } from '../components/Graph/KnowledgeGraph';

const EMPTY: GraphData = { nodes: [], links: [] };

export function useConnectionGraph(enabled: boolean, focus = '', attempt = 0) {
  const [state, setState] = useState({ graph: EMPTY, loading: false, error: '', processed: 0, total: 0 });
  useEffect(() => {
    setState({ graph: EMPTY, loading: enabled, error: '', processed: 0, total: 0 });
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      let cursor = '';
      do {
        const params = new URLSearchParams({ cursor, ...(focus ? { focus } : {}) });
        const response = await fetch('/api/graph?' + params, { signal: controller.signal });
        if (!response.ok) throw new Error('연결을 불러오지 못했습니다. 다시 시도해 주세요.');
        const batch: GraphBatch = await response.json();
        controller.signal.throwIfAborted();
        setState(previous => ({ graph: mergeGraphBatch(previous.graph, batch), loading: !batch.complete, error: '', processed: batch.processed, total: batch.total }));
        cursor = batch.nextCursor || '';
      } while (cursor);
    })().catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, graph: EMPTY, loading: false, error: error.message }));
    });
    return () => controller.abort();
  }, [enabled, focus, attempt]);
  return state;
}
