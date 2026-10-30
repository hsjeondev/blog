import * as React from "react";
import Link from "next/link";
import IonIcon from "./Icon";
import { KnowledgeGraph } from "./Graph/KnowledgeGraph";
import { compactNotionId } from "../utils/backlink-graph";
import { adjacentGraph } from "../utils/connection-graph";
import { useConnectionGraph } from "../hooks/useConnectionGraph";
import { motion } from "framer-motion";

interface BacklinksProps {
  currentId: string;
  currentTitle?: string;
  onNavigate?: (href: string, title?: string) => boolean;
}

export const Backlinks: React.FC<BacklinksProps> = ({ currentId, onNavigate }) => {
  const [requestedId, setRequestedId] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const requested = requestedId === currentId;
  const { graph: allConnections, loading, error, processed, total } = useConnectionGraph(requested, currentId, attempt);
  const graph = React.useMemo(() => adjacentGraph(allConnections, currentId), [allConnections, currentId]);
  const neighbors = Math.max(0, graph.nodes.length - 1);
  const incoming = graph.links.filter(link => link.target === currentId).length;
  const outgoing = graph.links.filter(link => link.source === currentId).length;

  return (
    <section className="backlink-graph" aria-labelledby={`backlink-title-${compactNotionId(currentId)}`}>
      <div className="backlink-graph-heading">
        <div>
          <b id={`backlink-title-${compactNotionId(currentId)}`}>이 기록과 연결된 책</b>
          <small>{!requested ? 'Notion 페이지 댓글의 @책 멘션으로 연결합니다.' : loading ? `연결을 확인하고 있습니다… ${total ? `${processed}/${total}` : ''}` : error ? error : neighbors ? `${neighbors}권 · 이 책에서 연결 ${outgoing}개 · 이 책을 가리키는 연결 ${incoming}개` : "아직 연결된 책이 없습니다."}</small>
          {(!requested || error) && <button type="button" onClick={() => { setRequestedId(currentId); setAttempt(value => value + 1); }}>연결된 기록 확인</button>}
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
      {requested && !!graph.links.length && <KnowledgeGraph data={graph} activeId={currentId} variant="compact" onNavigate={onNavigate} />}
    </section>
  );
};
