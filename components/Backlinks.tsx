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
  const connections = graph.links.length;

  return (
    <section className="backlink-graph" aria-labelledby={`backlink-title-${compactNotionId(currentId)}`}>
      <div className="backlink-graph-heading">
        <div>
          <b id={`backlink-title-${compactNotionId(currentId)}`}>연결된 이야기</b>
          <small>{loading || (!error && !graph.nodes.length) ? `연결을 확인하고 있습니다… ${total ? `${processed}/${total}` : ''}` : error ? error : `연결 ${connections}개`}</small>
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
