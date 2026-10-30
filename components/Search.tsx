import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { AnswerMarkdown } from "./Search/AnswerMarkdown";
import { AnswerStreamQueue, type AgentProgress } from "../utils/search/answer-stream";
import { useSearchResults } from "../hooks/useSearchResults";
import { SEARCH_SCOPES, scopeLabels, type SearchOptions, type SearchResult, type SearchScope } from "../utils/search/types";

const MotionLink = motion.create(Link);
const resultKey = (query: string, id: string) => `${query.trim()}:${id}`;

const SearchResultItem = React.forwardRef<HTMLAnchorElement, {
  result: SearchResult; active: boolean; reducedMotion: boolean; onClose: () => void; onFocus: () => void;
}>(function SearchResultItem({ result, active, reducedMotion, onClose, onFocus }, ref) {
  const isPresent = useIsPresent();
  return <MotionLink ref={ref} href={result.href} className={`global-search-result ${active ? "is-selected" : ""}`}
    aria-hidden={!isPresent || undefined} tabIndex={isPresent ? 0 : -1} style={{ pointerEvents: isPresent ? "auto" : "none" }}
    layout={reducedMotion ? false : "position"}
    initial={{ opacity: 0, y: reducedMotion ? 0 : 6, filter: reducedMotion ? "blur(0px)" : "blur(4px)" }}
    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
    exit={{ opacity: 0, y: reducedMotion ? 0 : -4, filter: reducedMotion ? "blur(0px)" : "blur(4px)" }}
    transition={{ duration: reducedMotion ? 0 : .18, ease: [.22, 1, .36, 1] }}
    onFocus={onFocus} onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) onClose(); }}>
    <motion.div key={`${result.title}:${result.excerpt || ""}`}
      initial={{ opacity: reducedMotion ? 1 : .45 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : .18 }}>
      <strong>{result.title}</strong>
      <small>{scopeLabels[result.type]}{result.folderPath && ` · ${result.folderPath.replaceAll("/", " / ")}`}</small>
      {(result.author || result.category) && <small>{[result.author, result.category].filter(Boolean).join(' · ')}</small>}
      {result.excerpt && <p>{result.excerpt}</p>}
    </motion.div>
  </MotionLink>;
});

export function Search({ onClose, initialOptions = {} }: { onClose: () => void; initialOptions?: SearchOptions }) {
  const router = useRouter();
  const aiGradientId = useId();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>(initialOptions.scope || "all");
  const [folder, setFolder] = useState(initialOptions.folder || "");
  const { results, loading, error, partial, body, searchBody, stopBody } = useSearchResults(query, scope, folder);
  const reducedMotion = useReducedMotion();
  const isPresent = useIsPresent();
  const [selected, setSelected] = useState(0);
  const [answerMode, setAnswerMode] = useState(false);
  const [agentStopped, setAgentStopped] = useState(false);
  const [answer, setAnswer] = useState("");
  const [progress, setProgress] = useState<AgentProgress[]>([]);
  const [progressOpen, setProgressOpen] = useState(true);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linksRef = useRef(new Map<string, HTMLAnchorElement>());
  const agentRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus?.({ preventScroll: true }); agentRef.current?.abort(); };
  }, []);

  useEffect(() => {
    agentRef.current?.abort();
    setAnswerMode(false); setAgentStopped(false); setProgress([]); setProgressOpen(true);
    setAnswer(""); setSources([]); setAgentError(""); setAgentLoading(false);
    setSelected(0);
  }, [query, scope, folder]);

  useEffect(() => { if (!isPresent) agentRef.current?.abort(); }, [isPresent]);
  useEffect(() => { setSelected((previous) => Math.min(previous, Math.max(0, results.length - 1))); }, [results.length]);

  const selectedResultId = results[selected]?.id;
  useEffect(() => {
    if (!answerMode && selectedResultId) linksRef.current.get(resultKey(query, selectedResultId))?.scrollIntoView({ block: "nearest" });
  }, [selectedResultId, query, answerMode]);

  const askAgent = async () => {
    if (!query.trim() || agentLoading) return;
    agentRef.current?.abort();
    const controller = new AbortController();
    agentRef.current = controller;
    setAnswerMode(true); setAgentStopped(false); setProgress([]); setProgressOpen(true);
    setAgentLoading(true); setAgentError(""); setAnswer(""); setSources([]);
    const queue = new AnswerStreamQueue((text) => { if (!controller.signal.aborted) setAnswer((previous) => previous + text); });
    let answerStarted = false;
    const beginAnswer = () => {
      if (answerStarted) return;
      answerStarted = true;
      setProgressOpen(false);
    };
    const cancelQueue = () => queue.cancel();
    controller.signal.addEventListener("abort", cancelQueue, { once: true });
    try {
      const response = await fetch("/api/agent/search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query.trim(), scope, folder }), signal: controller.signal,
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "AI 답변을 불러오지 못했습니다."); }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneEvent = false;
      const consume = (line: string) => {
        if (!line.trim() || controller.signal.aborted) return;
        const event = JSON.parse(line);
        if (event.type === "delta" && typeof event.text === "string" && event.text) {
          beginAnswer();
          queue.enqueue(event.text);
        }
        if (event.type === "progress" && typeof event.id === "string" && typeof event.label === "string"
          && ["running", "completed", "error"].includes(event.state)) {
          const next: AgentProgress = { id: event.id.slice(0, 80), kind: event.kind === "tool" ? "tool" : "status", label: event.label.slice(0, 200),
            detail: typeof event.detail === "string" ? event.detail.slice(0, 300) : undefined, state: event.state };
          if (next.id === "answer" && next.state === "running") beginAnswer();
          setProgress((current) => {
            const index = current.findIndex((item) => item.id === next.id);
            return index < 0 ? [...current, next].slice(-24) : current.map((item, position) => position === index ? next : item);
          });
        }
        if (event.type === "sources") setSources(event.sources);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "done") doneEvent = true;
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        lines.forEach(consume);
        if (done) { consume(buffer); break; }
      }
      if (!doneEvent) throw new Error("답변 연결이 끊겼습니다. 다시 시도해 주세요.");
      await queue.whenIdle();
    } catch (error) {
      if (!controller.signal.aborted) { setAgentError(error.message); setAnswer(""); setSources([]);
        setProgress((current) => current.map((item) => item.state === "running" ? { ...item, state: "error" } : item)); }
    } finally {
      queue.cancel(); controller.signal.removeEventListener("abort", cancelQueue);
      if (!controller.signal.aborted) { setAgentLoading(false); setProgressOpen(false); }
    }
  };

  return <motion.div className="global-search-backdrop" aria-hidden={!isPresent || undefined}
    initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
    animate={{ opacity: 1, backdropFilter: reducedMotion ? "blur(0px)" : "blur(8px)" }}
    exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
    transition={{ duration: reducedMotion ? 0 : .24, ease: [.22, 1, .36, 1] }}
    style={{ pointerEvents: isPresent ? "auto" : "none" }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-label="블로그 검색" className="global-search"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 14, scale: reducedMotion ? 1 : .975, filter: reducedMotion ? "blur(0px)" : "blur(10px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : 8, scale: reducedMotion ? 1 : .985, filter: reducedMotion ? "blur(0px)" : "blur(8px)" }}
      transition={{ duration: reducedMotion ? 0 : .22, ease: [.22, 1, .36, 1] }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const elements = Array.from(dialogRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]:not([tabindex="-1"]), input'));
          const first = elements[0]; const last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="global-search-input">
        <input ref={inputRef} value={query} maxLength={300} aria-label="블로그 검색어" placeholder="책 제목·저자·분류로 검색"
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void askAgent(); }
            else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !answerMode && results.length) {
              event.preventDefault(); setSelected((previous) => (previous + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            } else if (event.key === "Enter" && !answerMode && results[selected]) {
              event.preventDefault();
              void router.push(results[selected].href);
              onClose();
            }
          }} />
        {query && <button type="button" aria-label="검색어 지우기" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>지우기</button>}
        <button type="button" aria-label="검색 닫기" onClick={onClose}>닫기</button>
      </div>
      <div className="global-search-scopes" role="group" aria-label="검색 범위">
        <button type="button" className={answerMode ? "global-search-ai is-active" : "global-search-ai"} aria-pressed={answerMode} disabled={!query.trim()} onClick={() => { if (!answerMode) void askAgent(); }}>
          <svg className="global-search-ai-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <defs><linearGradient id={aiGradientId} x1="0" y1="0" x2="1" y2="1">
              <stop className="ai-gradient-start" offset="0%" stopColor="currentColor" /><stop className="ai-gradient-end" offset="100%" stopColor="currentColor" />
            </linearGradient></defs>
            <path fill={`url(#${aiGradientId})`} d="m10 2 2.8 7.2L20 12l-7.2 2.8L10 22l-2.8-7.2L0 12l7.2-2.8ZM20 1l1.1 2.9L24 5l-2.9 1.1L20 9l-1.1-2.9L16 5l2.9-1.1Z" />
          </svg>
          <span className="global-search-ai-label">AI</span>
        </button>
        {SEARCH_SCOPES.map((value) => <button key={value} type="button" aria-pressed={!answerMode && scope === value}
          onClick={() => {
            agentRef.current?.abort(); setAgentLoading(false); setAnswerMode(false); setAgentStopped(false);
            setScope(value); setFolder("");
          }}>{scopeLabels[value]}</button>)}
      </div>
      {folder && <button className="global-search-folder" type="button" onClick={() => setFolder("")}>{folder.replaceAll("/", " / ")} · 폴더 제한 해제</button>}
      <motion.div className="global-search-body" layoutScroll>
        {!answerMode && <>
        <div role="status" className="global-search-status">
          {!query.trim() ? "책 제목·저자·분류를 먼저 검색합니다. 본문은 ‘본문에서도 검색’으로 확인할 수 있습니다." : error ? error : loading ? "책 정보를 검색하고 있습니다…" : body.loading ? `검색 결과 ${results.length}개 · 본문 확인 중 ${body.scanned}/${body.total}` : `검색 결과 ${results.length}개`}
          {partial && <p>일부 본문은 확인하지 못했습니다.</p>}
          {body.error && <p role="alert">{body.error}</p>}
          {body.stopped && <p>본문 검색을 중지했습니다.</p>}
        </div>
        {query.trim() && !loading && !error && <button type="button" className="global-search-folder" onClick={body.loading ? stopBody : () => void searchBody()}>
          {body.loading ? '본문 검색 중지' : '본문에서도 검색'}
        </button>}
        {query.trim() && !loading && !body.loading && !error && !results.length && <p className="global-search-status">일치하는 글이 없습니다. 본문에서도 검색하거나 검색어를 바꿔 보세요.</p>}
        <motion.div className="global-search-results" aria-label="검색 결과" aria-busy={loading}>
          <AnimatePresence initial={false} mode="popLayout">
          {results.map((result, index) => <SearchResultItem key={resultKey(query, result.id)} result={result}
            active={selected === index} reducedMotion={!!reducedMotion} onClose={onClose} onFocus={() => setSelected(index)}
            ref={(element) => {
              const key = resultKey(query, result.id);
              if (element) linksRef.current.set(key, element); else linksRef.current.delete(key);
            }} />)}
          </AnimatePresence>
        </motion.div>
        </>}
        {answerMode && <motion.section className="global-search-answer" aria-label="AI 답변" aria-busy={agentLoading}
          initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : .2 }}>
          <h3>AI 답변</h3>
          {!!progress.length && <details className="global-search-progress" open={progressOpen} onToggle={(event) => setProgressOpen(event.currentTarget.open)}>
            <summary>진행 과정 <span>{agentLoading ? "생성 중" : agentStopped ? "중지됨" : agentError ? "오류" : "완료"} · 도구 {progress.filter((item) => item.kind === "tool").length}회</span></summary>
            <ol>{progress.map((item) => <li key={item.id} data-state={item.state}>
              <span className="global-search-progress-state" aria-label={item.state === "running" ? "진행 중" : item.state === "completed" ? "완료" : item.state === "stopped" ? "중지" : "오류"}>{item.state === "running" ? "◌" : item.state === "completed" ? "✓" : "−"}</span>
              <div><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</div>
            </li>)}</ol>
          </details>}
          {agentLoading && !answer && <p role="status">{progress.some((item) => item.id === "answer") ? "답변을 작성하고 있습니다…" : "블로그에서 근거를 확인하고 있습니다…"}</p>}
          {agentStopped && <p role="status">답변 생성을 중지했습니다.</p>}
          {agentError && <p role="alert">{agentError}</p>}
          {answer && <AnswerMarkdown text={answer} reducedMotion={!!reducedMotion} sources={sources} />}
          {!!sources.length && <div aria-label="참고한 문서">{sources.map((source, index) => <Link key={source.id} href={source.href}
            target="_blank" rel="noopener noreferrer" aria-label={`${source.title} (새 탭)`}>[{index + 1}] {source.title}</Link>)}</div>}
        </motion.section>}
      </motion.div>
      {answerMode && agentLoading && <div className="global-search-footer">
        {agentLoading && <button type="button" onClick={() => { agentRef.current?.abort(); setAgentLoading(false); setAgentStopped(true);
          setProgress((current) => current.map((item) => item.state === "running" ? { ...item, state: "stopped" } : item)); }}>중지</button>}
      </div>}
    </motion.div>
  </motion.div>;
}
