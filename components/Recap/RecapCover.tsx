import { useEffect, useRef, useState } from "react";
import { recapCoverTitle } from "../../utils/recap-pagination";

export default function RecapCover({ post }: {
  post: { date: string; title: string; subtitle?: string }; ready: boolean; failed: boolean; empty: boolean; onStart: () => void; onRetry: () => void;
}) {
  const title = recapCoverTitle(post);
  const cover = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const episode = useRef<HTMLHeadingElement>(null);
  const [layout, setLayout] = useState({ fontSize: undefined as number | undefined, titleHeight: undefined as number | undefined });
  useEffect(() => {
    const node = heading.current;
    const root = cover.current;
    if (!node || !root) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      node.style.removeProperty("font-size");
      const style = getComputedStyle(node);
      const scale = parseFloat(style.getPropertyValue("--recap-cover-title-scale")) || 1;
      const base = parseFloat(style.fontSize);
      const episodeHeight = episode.current?.offsetHeight || 0;
      const gap = parseFloat(getComputedStyle(root).getPropertyValue("--recap-cover-title-gap")) || 20;
      const budget = Math.max(32, root.clientHeight - episodeHeight - gap * 2 - 24);
      let size = base;
      while ((node.scrollHeight * scale > budget || node.scrollWidth > node.clientWidth + 1) && size > 16) {
        size -= 1;
        node.style.fontSize = `${size}px`;
      }
      const next = { fontSize: size, titleHeight: Math.ceil(node.offsetHeight * scale) };
      setLayout((current) => current.fontSize === next.fontSize && current.titleHeight === next.titleHeight ? current : next);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    document.fonts.ready.then(fit);
    fit();
    return () => { cancelled = true; observer.disconnect(); };
  }, [title, post.title]);
  return <div ref={cover} className="recap-cover recap-cover-sky">
    <div className="recap-cover-titles">
      <h3 ref={episode} className="recap-cover-subtitle recap-cover-line">EP.{post.title}</h3>
      <div className="recap-cover-title-frame" style={{ height: layout.titleHeight }}>
        <h1 ref={heading} aria-label={title} style={{ fontSize: layout.fontSize }}>
          {title.split(/\r?\n/).map((line, index) => <span className="recap-cover-line" aria-hidden="true" key={index} style={{ animationDelay: `${(index + 1) * .38}s` }}>{line || "\u00a0"}</span>)}
        </h1>
      </div>
    </div>
  </div>;
}
