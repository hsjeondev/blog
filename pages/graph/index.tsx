import * as React from "react";
import IonIcon from "@reacticons/ionicons";
import { useRouter } from "next/router";
import { PageHead } from "../../components/PageHead";
import { KnowledgeGraph, type GraphData } from "../../components/Graph/KnowledgeGraph";
import { compactNotionId } from "../../utils/backlink-graph";

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

export default function GraphPage() {
  const router = useRouter();
  const [graph, setGraph] = React.useState<GraphData>(EMPTY_GRAPH);
  const [query, setQuery] = React.useState("");
  const [appliedQuery, setAppliedQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const focusedId = typeof router.query.focus === "string" ? router.query.focus : undefined;

  React.useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setAppliedQuery(query), 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/graph", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("그래프를 불러오지 못했습니다.")))
      .then((data) => setGraph({ nodes: data.nodes || [], links: data.links || [] }))
      .catch((fetchError) => {
        if (fetchError.name !== "AbortError") setError(fetchError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const visibleGraph = React.useMemo<GraphData>(() => {
    const normalized = appliedQuery.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return graph;
    const matched = new Set(graph.nodes
      .filter((node) => node.title.toLocaleLowerCase("ko-KR").includes(normalized))
      .map((node) => compactNotionId(node.id)));
    const visible = new Set(matched);
    graph.links.forEach((link) => {
      const source = compactNotionId(link.source);
      const target = compactNotionId(link.target);
      if (matched.has(source) || matched.has(target)) {
        visible.add(source);
        visible.add(target);
      }
    });
    return {
      nodes: graph.nodes.filter((node) => visible.has(compactNotionId(node.id))),
      links: graph.links.filter((link) => visible.has(compactNotionId(link.source)) && visible.has(compactNotionId(link.target))),
    };
  }, [appliedQuery, graph]);
  const visibleDocumentCount = visibleGraph.nodes.filter((node) => node.kind !== "group").length;
  const visibleReferenceCount = visibleGraph.links.filter((link) => link.kind !== "membership").length;
  const closeSearch = () => {
    setQuery("");
    setAppliedQuery("");
    setSearchOpen(false);
  };

  return (
    <main className="graph-page">
      <PageHead title="문서 그래프 | 프리머그의 Blog" url="https://blog.yuntae.in/graph" />
      <section className="graph-stage" aria-live="polite">
        <button type="button" className="graph-back-button" onClick={() => router.back()} aria-label="이전 페이지로 돌아가기">
          <IonIcon name="chevron-back-outline" />
        </button>

        <div className={`graph-search ${searchOpen ? "is-open" : ""}`}>
          {!searchOpen ? (
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="문서 검색 열기" aria-expanded="false">
              <IonIcon name="search-outline" />
            </button>
          ) : (
            <>
              <IonIcon name="search-outline" aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }}
                placeholder="문서 검색"
                aria-label="그래프 문서 검색"
              />
              <button type="button" onClick={closeSearch} aria-label="검색 닫기">
                <IonIcon name="close-outline" />
              </button>
            </>
          )}
        </div>

        <div className="graph-stats">
          <span><b>{visibleDocumentCount}</b> 문서</span>
          <span><b>{visibleReferenceCount}</b> 연결</span>
        </div>
        <div className="graph-legend" aria-label="그래프 분류 범례">
          <span><i className="is-post" />포스팅</span>
          <span><i className="is-project" />프로젝트</span>
          <span><i className="is-recap" />월말결산</span>
          <span><i className="is-document" />문서</span>
        </div>
        {loading && <p className="graph-state">연결을 정리하고 있습니다…</p>}
        {error && <p className="graph-state is-error">{error}</p>}
        {!loading && !error && !visibleGraph.nodes.length && <p className="graph-state">일치하는 문서가 없습니다.</p>}
        {!!visibleGraph.nodes.length && <KnowledgeGraph data={visibleGraph} activeId={focusedId} variant="full" />}
      </section>
    </main>
  );
}
