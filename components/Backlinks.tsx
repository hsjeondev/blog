import * as React from "react";
import Link from "next/link";
import IonIcon from "./Icon";
import { KnowledgeGraph, type GraphData } from "./Graph/KnowledgeGraph";
import { compactNotionId, resolveBacklinkSources } from "../utils/backlink-graph";
import { motion } from "framer-motion";

interface BacklinksProps {
  currentId: string;
  currentTitle?: string;
  onNavigate?: (href: string, title?: string) => boolean;
}

export const Backlinks: React.FC<BacklinksProps> = ({ currentId, currentTitle = "현재 문서", onNavigate }) => {
  const [sources, setSources] = React.useState<ReturnType<typeof resolveBacklinkSources>>([]);
  const [requestedId, setRequestedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (requestedId !== currentId) return;
    const controller = new AbortController();
    setSources([]);
    setLoading(true);
    setError(false);
    fetch("/api/backlink", {
      method: "POST",
      body: JSON.stringify({ currentId }),
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("backlink request failed")))
      .then((payload) => setSources(resolveBacklinkSources(payload).filter(
        (source) => compactNotionId(source.id) !== compactNotionId(currentId),
      )))
      .catch((error) => {
        if (error.name !== "AbortError") { setSources([]); setError(true); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentId, requestedId, attempt]);

  const graph = React.useMemo<GraphData>(() => ({
    nodes: [
      { id: currentId, title: currentTitle, href: `/${currentId}`, kind: "current" },
      ...sources.map((source) => ({ ...source, kind: "reference" as const })),
    ],
    links: sources.map((source) => ({ source: source.id, target: currentId })),
  }), [currentId, currentTitle, sources]);

  return (
    <section className="backlink-graph" aria-labelledby={`backlink-title-${compactNotionId(currentId)}`}>
      <div className="backlink-graph-heading">
        <div>
          <b id={`backlink-title-${compactNotionId(currentId)}`}>이 문서를 가리키는 연결</b>
          <small>{requestedId !== currentId ? '필요할 때 연결된 기록을 확인할 수 있습니다.' : loading ? '연결된 기록을 확인하고 있습니다…' : error ? '연결을 불러오지 못했습니다.' : sources.length ? `${sources.length}개의 문서가 연결되어 있습니다.` : "아직 연결된 문서가 없습니다."}</small>
          {(requestedId !== currentId || error) && <button type="button" onClick={() => { setSources([]); setError(false); setRequestedId(currentId); setAttempt(value => value + 1); }}>연결된 기록 확인</button>}
        </div>
        <Link href={`/graph?focus=${encodeURIComponent(currentId)}`} className="no-underline">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="px-4 py-2 text-xs rounded-xl hover:bg-blue-600 transition-colors float-right"
            style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
            type="submit"
          >
            전체 그래프
            <IonIcon name="arrow-forward-outline" style={{ position: 'relative', top: '2px' }} />
          </motion.button>

        </Link>
      </div>
      {requestedId === currentId && !!sources.length && <KnowledgeGraph data={graph} activeId={currentId} variant="compact" onNavigate={onNavigate} />}
    </section>
  );
};
