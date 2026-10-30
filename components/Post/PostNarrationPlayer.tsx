import IonIcon from "../Icon";
import { AnimatePresence, motion } from "framer-motion";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Segment = { text: string; start: number; end: number };
type NarrationBlock = { hash: string; text: string; duration: number; audioUrl: string; segments: Segment[] };
type Manifest = { status: string; blocks: Record<string, NarrationBlock> };
type QueueItem = NarrationBlock & { blockId: string; element: HTMLElement; spans: HTMLElement[][] };

const LEAD_SECONDS = 0.12;

function matchKey(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function alignedSegments(sourceText: string, block: NarrationBlock): Segment[] {
  const segments = block.segments?.length ? block.segments : [{ text: block.text, start: 0, end: block.duration }];
  if (!sourceText) return segments;
  let normalizedSource = "";
  const sourceIndexes: number[] = [];
  for (let index = 0; index < sourceText.length;) {
    const character = String.fromCodePoint(sourceText.codePointAt(index) || 0);
    const normalized = matchKey(character);
    normalizedSource += normalized;
    for (let offset = 0; offset < normalized.length; offset += 1) sourceIndexes.push(index);
    index += character.length || 1;
  }
  let cursor = 0;
  const starts: number[] = [];
  const matched = segments.every((segment) => {
    const key = matchKey(segment.text);
    const found = key ? normalizedSource.indexOf(key, cursor) : -1;
    if (found < 0) return false;
    starts.push(sourceIndexes[found] ?? 0);
    cursor = found + key.length;
    return true;
  });
  if (matched) return segments.map((segment, index) => ({
    ...segment,
    text: sourceText.slice(index ? starts[index] : 0, index + 1 < starts.length ? starts[index + 1] : sourceText.length),
  }));
  const weights = segments.map((segment) => Math.max(1, matchKey(segment.text).length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let sourceCursor = 0;
  let elapsed = 0;
  return segments.map((segment, index) => {
    elapsed += weights[index];
    const end = index === segments.length - 1 ? sourceText.length : Math.round(sourceText.length * elapsed / total);
    const text = sourceText.slice(sourceCursor, end);
    sourceCursor = end;
    return { ...segment, text };
  });
}

function ownsTextNode(root: HTMLElement, node: Text) {
  let element = node.parentElement;
  while (element && element !== root) {
    if ([...element.classList].some((name) => name.startsWith("notion-block-"))) return false;
    element = element.parentElement;
  }
  return true;
}

function decorateBlock(element: HTMLElement, block: NarrationBlock): HTMLElement[][] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (text.data && ownsTextNode(element, text) && !text.parentElement?.closest(".notion-hash-link, button, script, style")) nodes.push(text);
    current = walker.nextNode();
  }
  const source = nodes.map((node) => node.data).join("");
  const segments = alignedSegments(source, block);
  const boundaries: number[] = [];
  segments.reduce((offset, segment) => {
    boundaries.push(offset + segment.text.length);
    return offset + segment.text.length;
  }, 0);
  const spans = segments.map(() => [] as HTMLElement[]);
  let globalOffset = 0;
  nodes.forEach((node) => {
    const fragment = document.createDocumentFragment();
    let localOffset = 0;
    while (localOffset < node.data.length) {
      const absolute = globalOffset + localOffset;
      const foundSegment = boundaries.findIndex((boundary) => absolute < boundary);
      const segmentIndex = foundSegment < 0 ? segments.length - 1 : foundSegment;
      const boundary = boundaries[segmentIndex] ?? globalOffset + node.data.length;
      const length = Math.max(1, Math.min(node.data.length - localOffset, boundary - absolute));
      const span = document.createElement("span");
      span.className = "post-narration-segment is-upcoming";
      span.dataset.narrationSegment = String(segmentIndex);
      span.textContent = node.data.slice(localOffset, localOffset + length);
      spans[segmentIndex]?.push(span);
      fragment.appendChild(span);
      localOffset += length;
    }
    globalOffset += node.data.length;
    node.replaceWith(fragment);
  });
  element.classList.add("post-narration-block", "is-upcoming");
  return spans;
}

function clearDecorations(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>(".post-narration-segment").forEach((span) => span.replaceWith(document.createTextNode(span.textContent || "")));
  root?.querySelectorAll<HTMLElement>(".post-narration-block").forEach((element) => {
    element.classList.remove("post-narration-block", "is-past", "is-active", "is-upcoming");
    element.normalize();
  });
}

export function PostNarrationPlayer({ pageId, contentRef }: { pageId: string; contentRef: RefObject<HTMLDivElement> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [blockIndex, setBlockIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameRef = useRef(0);
  const queueRef = useRef<QueueItem[]>([]);
  const blockIndexRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const desiredPlayingRef = useRef(false);

  const stop = useCallback(() => {
    desiredPlayingRef.current = false;
    cancelAnimationFrame(frameRef.current);
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = "";
    setIsPlaying(false);
    clearDecorations(contentRef.current);
    queueRef.current = [];
    setQueue([]);
    setBlockIndex(0);
    setSegmentIndex(0);
    segmentIndexRef.current = 0;
  }, [contentRef]);

  const paint = useCallback((time: number) => {
    const items = queueRef.current;
    const currentBlock = blockIndexRef.current;
    items.forEach((item, index) => {
      const state = index < currentBlock ? "is-past" : index === currentBlock ? "is-active" : "is-upcoming";
      item.element.classList.remove("is-past", "is-active", "is-upcoming");
      item.element.classList.add(state);
      if (index !== currentBlock) item.spans.flat().forEach((span) => {
        const progress = index < currentBlock ? 100 : 0;
        span.classList.toggle("is-past", progress === 100);
        span.classList.remove("is-live");
        span.classList.toggle("is-upcoming", progress === 0);
        span.style.setProperty("--narration-progress", `${progress}%`);
      });
    });
    const item = items[currentBlock];
    if (!item) return;
    let active = 0;
    item.segments.forEach((segment, index) => { if (time + LEAD_SECONDS >= segment.start) active = index; });
    segmentIndexRef.current = active;
    setSegmentIndex((current) => current === active ? current : active);
    item.spans.forEach((pieces, index) => {
      const segment = item.segments[index];
      const progress = index < active ? 1 : index > active ? 0 : Math.max(0, Math.min(1, (time + LEAD_SECONDS - segment.start) / Math.max(0.01, segment.end - segment.start)));
      pieces.forEach((span) => {
        span.classList.toggle("is-past", progress >= 1);
        span.classList.toggle("is-live", index === active && progress < 1);
        span.classList.toggle("is-upcoming", progress <= 0);
        span.style.setProperty("--narration-progress", `${progress * 100}%`);
      });
    });
  }, []);

  const playBlock = useCallback((index: number, targetSegment = 0, shouldPlay = true) => {
    const item = queueRef.current[index];
    if (!item) return;
    const audio = audioRef.current || new Audio();
    audioRef.current = audio;
    const blockChanged = audio.dataset.narrationBlockId !== item.blockId;
    blockIndexRef.current = index;
    setBlockIndex(index);
    setSegmentIndex(targetSegment);
    segmentIndexRef.current = targetSegment;
    audio.preload = "auto";

    if (shouldPlay) {
      desiredPlayingRef.current = true;
      setIsPlaying(true);
    } else {
      desiredPlayingRef.current = false;
      setIsPlaying(false);
    }

    const seek = () => {
      audio.currentTime = item.segments[targetSegment]?.start || 0;
      paint(audio.currentTime);
      item.element.scrollIntoView({ behavior: "smooth", block: "center" });
      if (shouldPlay) {
        audio.play().catch(() => {
          desiredPlayingRef.current = false;
          setIsPlaying(false);
          setError("오디오 재생이 차단되었습니다.");
          stop();
        });
      }
    };
    audio.ontimeupdate = () => paint(audio.currentTime);
    audio.onplay = () => {
      desiredPlayingRef.current = true;
      setIsPlaying(true);
      const tick = () => {
        paint(audio.currentTime);
        if (!audio.paused && !audio.ended) frameRef.current = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };
    audio.onpause = () => {
      if (desiredPlayingRef.current) return;
      cancelAnimationFrame(frameRef.current);
      setIsPlaying(false);
    };
    audio.onended = () => {
      cancelAnimationFrame(frameRef.current);
      if (index + 1 < queueRef.current.length) {
        playBlock(index + 1, 0, true);
      } else {
        stop();
      }
    };
    if (blockChanged) {
      audio.dataset.narrationBlockId = item.blockId;
      audio.src = item.audioUrl;
      audio.onloadedmetadata = seek;
      audio.load();
    } else {
      seek();
    }
  }, [paint, stop]);

  const start = useCallback(async () => {
    if (loading || queue.length) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/narration/${pageId}`);
      if (!response.ok) throw new Error("manifest unavailable");
      const manifest: Manifest = await response.json();
      const root = contentRef.current;
      if (!root || manifest.status !== "ready") throw new Error("manifest unavailable");
      const items = Object.entries(manifest.blocks).flatMap(([blockId, block]) => {
        const element = root.querySelector<HTMLElement>(`.notion-block-${blockId.replaceAll("-", "")}`);
        if (!element) return [];
        const segments = alignedSegments(element.textContent || block.text, block);
        return [{ ...block, segments, blockId, element, spans: decorateBlock(element, { ...block, segments }) }];
      }).sort((a, b) => a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      if (!items.length) throw new Error("manifest unavailable");
      queueRef.current = items;
      setQueue(items);
      playBlock(0, 0);
    } catch {
      clearDecorations(contentRef.current);
      setError("이 게시물의 음성을 아직 준비하지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [contentRef, loading, pageId, playBlock, queue.length]);

  const getSentenceStarts = useCallback(() => {
    const sentenceStarts: { blockIndex: number; segmentIndex: number }[] = [];
    queueRef.current.forEach((block, bIdx) => {
      if (!block.segments || block.segments.length === 0) return;
      sentenceStarts.push({ blockIndex: bIdx, segmentIndex: 0 });
      for (let i = 0; i < block.segments.length - 1; i++) {
        const text = block.segments[i].text.trim();
        if (/[.!?~…]['"”’)]*\s*$/.test(text)) {
          sentenceStarts.push({ blockIndex: bIdx, segmentIndex: i + 1 });
        }
      }
    });
    return sentenceStarts;
  }, []);

  const seekSentence = useCallback((direction: number) => {
    const queueItems = queueRef.current;
    if (!queueItems.length) return;

    const sentenceStarts = getSentenceStarts();
    if (!sentenceStarts.length) return;

    const curBlock = blockIndexRef.current;
    const curSeg = segmentIndexRef.current;
    const currentTime = audioRef.current?.currentTime ?? 0;
    const shouldPlay = desiredPlayingRef.current;

    let curSentenceIdx = -1;
    for (let i = 0; i < sentenceStarts.length; i++) {
      const { blockIndex, segmentIndex } = sentenceStarts[i];
      if (blockIndex < curBlock || (blockIndex === curBlock && segmentIndex <= curSeg)) {
        curSentenceIdx = i;
      } else {
        break;
      }
    }

    if (curSentenceIdx === -1) curSentenceIdx = 0;

    if (direction > 0) {
      const nextIdx = curSentenceIdx + 1;
      if (nextIdx < sentenceStarts.length) {
        const target = sentenceStarts[nextIdx];
        playBlock(target.blockIndex, target.segmentIndex, shouldPlay);
      }
    } else {
      const curTarget = sentenceStarts[curSentenceIdx];
      const curSentenceStartAudioTime = queueItems[curTarget.blockIndex]?.segments[curTarget.segmentIndex]?.start ?? 0;
      const elapsedInSentence = curBlock === curTarget.blockIndex ? currentTime - curSentenceStartAudioTime : 2.0;

      if (elapsedInSentence > 1.5) {
        playBlock(curTarget.blockIndex, curTarget.segmentIndex, shouldPlay);
      } else {
        const prevIdx = curSentenceIdx - 1;
        if (prevIdx >= 0) {
          const target = sentenceStarts[prevIdx];
          playBlock(target.blockIndex, target.segmentIndex, shouldPlay);
        } else {
          playBlock(0, 0, shouldPlay);
        }
      }
    }
  }, [getSentenceStarts, playBlock]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      desiredPlayingRef.current = true;
      setIsPlaying(true);
      audio.play().catch(() => {
        desiredPlayingRef.current = false;
        setIsPlaying(false);
        setError("오디오 재생이 차단되었습니다.");
      });
    } else {
      desiredPlayingRef.current = false;
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  useEffect(() => stop, [stop]);

  return (
    <>
      <div className="post-narration-entry">
        <button type="button" onClick={start} disabled={loading || queue.length > 0}>
          <IonIcon name={loading ? "sync-outline" : "headset-outline"} />
          <span>{loading ? "음성을 불러오는 중" : queue.length ? "음성 재생 중" : "음성으로 듣기"}</span>
        </button>
        {error && <small role="status">{error}</small>}
      </div>
      <AnimatePresence>
        {queue.length > 0 && (
          <motion.nav className="post-narration-toolbar" aria-label="게시물 음성 재생" initial={{ opacity: 0, y: 28, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.96 }} transition={{ type: "spring", stiffness: 330, damping: 30 }}>
            <span><strong>{blockIndex + 1}</strong><small>/ {queue.length}</small></span>

            <button type="button" aria-label="이전 문장" onClick={() => seekSentence(-1)} disabled={blockIndex === 0 && segmentIndex === 0}><IonIcon name="play-skip-back" /></button>
            <button type="button" className="is-playback" aria-label={isPlaying ? "일시정지" : "재생"} aria-pressed={!isPlaying} onClick={togglePlayback}><IonIcon name={isPlaying ? "pause" : "play"} /></button>
            <button type="button" aria-label="다음 문장" onClick={() => seekSentence(1)} disabled={blockIndex === queue.length - 1 && segmentIndex === queue[blockIndex]?.segments.length - 1}><IonIcon name="play-skip-forward" /></button>
            <button type="button" className="is-close" aria-label="음성 재생 종료" onClick={stop}><IonIcon name="close" /></button>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
