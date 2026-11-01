import * as React from "react";
import Link from "next/link";
import IonIcon from "./Icon";
import { KnowledgeGraph } from "./Graph/KnowledgeGraph";
import { compactNotionId } from "../utils/backlink-graph";
import { adjacentGraph } from "../utils/connection-graph";
import { useConnectionGraph } from "../hooks/useConnectionGraph";

interface BacklinksProps {
  currentId: string;
  currentTitle?: string;
  onNavigate?: (href: string, title?: string) => boolean;
}

export const Backlinks: React.FC<BacklinksProps> = ({ currentId, onNavigate }) => {
  const [attempt, setAttempt] = React.useState(0);
  const { graph: allConnections, loading, error, processed, total } = useConnectionGraph(true, currentId, attempt);
  const graph = React.useMemo(() => adjacentGraph(allConnections, currentId), [allConnections, currentId]);
  const neighbors = Math.max(0, graph.nodes.length - 1);
  const incoming = graph.links.filter(link => link.target === currentId).length;
  const outgoing = graph.links.filter(link => link.source === currentId).length;

  return (
    <section className="backlink-graph" aria-labelledby={`backlink-title-${compactNotionId(currentId)}`}>
      <div className="backlink-graph-heading">
        <div>
          <b id={`backlink-title-${compactNotionId(currentId)}`}>이 기록과 연결된 책</b>
          <small>{loading || (!error && !graph.nodes.length) ? `연결을 확인하고 있습니다… ${total ? `${processed}/${total}` : ''}` : error ? error : neighbors ? `${neighbors}권 · 이 책에서 연결 ${outgoing}개 · 이 책을 가리키는 연결 ${incoming}개` : "아직 연결된 책이 없습니다."}</small>
          {error && <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>}
        </div>
        <Link href={`/graph?focus=${encodeURIComponent(currentId)}`} className="backlink-graph-cta no-underline">
          <span>전체 그래프</span>
          <IonIcon name="arrow-forward-outline" aria-hidden="true" />
        </Link>
      </div>
      {!!graph.nodes.length && <KnowledgeGraph data={graph} activeId={currentId} variant="compact" onNavigate={onNavigate} />}
    </section>
  );
};
