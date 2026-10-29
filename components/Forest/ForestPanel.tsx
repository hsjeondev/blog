import IonIcon from "@reacticons/ionicons";
import { useEffect, useRef, useState } from "react";
import { getPageTitle } from "notion-utils";
import { blockValue } from "../../utils/backlink-graph";
import { forestPageIdFromHref } from "../../utils/forest-navigation";
import { NotionRenderer } from "../../packages/notionx";
import { useDarkMode } from "../../hooks/useDarkMode";
import { Code, Collection, Equation, Modal, mapPublishedImageUrl } from "../../utils/notion-components";
import type { ForestDocument } from "../../utils/search/folders";
import { Backlinks } from "../Backlinks";
import Comments from "../Comments";

const components = { Code, Collection, Equation, Modal };
const date = (value: string | number) => {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(parsed)) : "정보 없음";
};
export function ForestPanel({ document: doc, anchor, collapsed, mobileVisible, onExpand, onClose, onBack, onNavigate }: {
  document: ForestDocument; collapsed: boolean; mobileVisible: boolean;
  anchor: string;
  onExpand: () => void; onClose: () => void; onBack: () => void; onNavigate: (href: string, title?: string) => boolean;
}) {
  const darkMode = useDarkMode();
  const [recordMap, setRecordMap] = useState<any>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [shareStatus, setShareStatus] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const title = recordMap ? getPageTitle(recordMap) || doc.title : doc.title;
  const root = recordMap ? blockValue(recordMap.block?.[doc.id]) : null;
  const share = async () => {
    const url = `${window.location.origin}/${doc.id}`;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setShareStatus("문서 링크를 복사했습니다."); }
    } catch (reason) {
      if (reason.name !== "AbortError") setShareStatus("공유하지 못했습니다. 새 탭으로 문서를 열어 주소를 복사해 주세요.");
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(`/api/forest/${doc.id}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("문서를 불러오지 못했습니다.");
      return response.json();
    }).then((value) => {
      if (controller.signal.aborted) return;
      setRecordMap(value);
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [doc.id, attempt]);
  useEffect(() => {
    if (!recordMap || !anchor || collapsed) return;
    let id = anchor;
    try { id = decodeURIComponent(anchor); } catch { }
    const target = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[id]") || [])].find((element) => element.id === id || element.id.replaceAll("-", "") === id.replaceAll("-", ""));
    if (target && scrollRef.current) scrollRef.current.scrollTop += target.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 16;
  }, [anchor, recordMap, collapsed]);
  return <section data-document-id={doc.id} className={`forest-panel ${collapsed ? "is-collapsed" : "is-expanded"} ${mobileVisible ? "is-mobile-visible" : ""}`} aria-label={title}>
    <button type="button" className="forest-panel-strip" aria-label={`${title} 펼치기`} onClick={onExpand} hidden={!collapsed}>{title}</button>
    <div className="forest-panel-content" inert={collapsed || undefined} aria-hidden={collapsed || undefined}>
      <header className="forest-panel-header">
        <button className="forest-icon-button forest-back" type="button" aria-label="문서 목록으로 돌아가기" onClick={onBack}><IonIcon name="arrow-back-outline" /></button>
        <h2 title={title}>{title}</h2>
        <details className="forest-panel-metadata"><summary className="forest-icon-button" aria-label="문서 정보" title="문서 정보"><IonIcon name="information-circle-outline" /></summary>
          <dl>{doc.folderPath && <><dt>경로</dt><dd>{doc.folderPath.replaceAll("/", " / ")}</dd></>}
            <dt>생성</dt><dd>{date(doc.createdTime || root?.created_time || "")}</dd>
            <dt>수정</dt><dd>{date(doc.lastEditedTime || root?.last_edited_time || "")}</dd>
          </dl>
        </details>
        <a href={`/${doc.id}`} target="_blank" rel="noopener noreferrer" className="forest-icon-button" aria-label={`${title} 이 문서만 보기 (새 탭)`} title="이 문서만 보기 (새 탭)"><IonIcon name="open-outline" /></a>
        <button className="forest-icon-button" type="button" aria-label="문서 공유" title="문서 공유" onClick={() => void share()}><IonIcon name="share-outline" /></button>
        <button className="forest-icon-button" type="button" aria-label={`${title} 닫기`} title="문서 닫기" onClick={onClose}><IonIcon name="close-outline" /></button>
      </header>
      {shareStatus && <p className="forest-share-status" role="status">{shareStatus}</p>}
      <div className="forest-preview-scroll" ref={scrollRef}>
        {error ? <div className="forest-document-error" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button></div>
          : !recordMap ? <p className="forest-empty-list" role="status">문서를 불러오는 중입니다…</p> : <article className="forest-notion-document">
            <div onClickCapture={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
              if (!link || link.hasAttribute("download")) return;
              const url = new URL(link.href);
              if (url.hash && forestPageIdFromHref(link.href, window.location.origin) === doc.id) {
                const target = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[id]") || [])].find((element) => element.id.replaceAll("-", "") === url.hash.slice(1).replaceAll("-", ""));
                if (target && scrollRef.current) scrollRef.current.scrollTop += target.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 16;
              }
              if (onNavigate(link.href)) { event.preventDefault(); event.stopPropagation(); }
            }}>
              <NotionRenderer recordMap={recordMap} mapImageUrl={mapPublishedImageUrl} components={components} fullPage={false} darkMode={darkMode} showTableOfContents={false} previewImages={!!recordMap.preview_images} />
            </div>
            <Backlinks currentId={doc.id} currentTitle={title} onNavigate={onNavigate} />
            <Comments pageId={doc.id} />
          </article>}
      </div>
    </div>
  </section>;
}
