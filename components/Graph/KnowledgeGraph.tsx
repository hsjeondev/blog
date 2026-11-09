import * as React from "react";
import * as d3 from "d3";
import { compactNotionId } from "../../utils/backlink-graph";
import { fitGraphBounds } from "../../utils/graph-viewport";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export type GraphNode = {
  id: string;
  title: string;
  href: string;
  kind?: "post" | "project" | "recap" | "document" | "reference" | "current" | "group";
  group?: "post" | "project" | "recap" | "document";
};

export type GraphLink = { source: string; target: string; kind?: "reference" | "membership" };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };
type SimulationNode = GraphNode & {
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  anchorX?: number;
  anchorY?: number;
  orbitRadius?: number;
};

type KnowledgeGraphProps = {
  data: GraphData;
  activeId?: string;
  variant?: "compact" | "full";
  className?: string;
  onNavigate?: (href: string, title?: string) => boolean;
};

export function KnowledgeGraph({ data, activeId, variant = "full", className = "", onNavigate }: KnowledgeGraphProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const navigateRef = React.useRef(onNavigate);
  const resetViewRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => { navigateRef.current = onNavigate; }, [onNavigate]);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  useIsomorphicLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !size.width || !size.height || !data.nodes.length) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();
    const viewport = svg.append("g");
    const activeKey = compactNotionId(activeId);
    const center = { x: size.width / 2, y: size.height / 2 };
    const graphRadius = Math.max(150, Math.min(size.width, size.height) * 0.43);
    const groupAngles = {
      post: Math.PI * 1.2,
      project: Math.PI * 0.8,
      recap: Math.PI * 1.8,
      document: Math.PI * 0.2,
    };
    const clusterAnchors = Object.fromEntries(Object.entries(groupAngles).map(([group, angle]) => [group, {
      x: center.x + Math.cos(angle) * graphRadius * 0.3,
      y: center.y + Math.sin(angle) * graphRadius * 0.3,
    }])) as Record<"post" | "project" | "recap" | "document", { x: number; y: number }>;
    const nodes = data.nodes.map((item) => {
      const anchor = item.group ? clusterAnchors[item.group] : undefined;
      const hash = [...item.id].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7);
      const groupAngle = item.group ? groupAngles[item.group] : (hash % 360) * (Math.PI / 180);
      const angleOffset = ((((hash >>> 8) % 1000) / 999) - 0.5) * 1.36;
      const angle = groupAngle + angleOffset;
      const orbitRadius = graphRadius * (0.28 + ((hash >>> 18) % 68) / 100);
      const isGroup = item.kind === "group";
      return {
        ...item,
        x: isGroup ? anchor?.x : center.x + Math.cos(angle) * orbitRadius,
        y: isGroup ? anchor?.y : center.y + Math.sin(angle) * orbitRadius,
        anchorX: isGroup ? anchor?.x : undefined,
        anchorY: isGroup ? anchor?.y : undefined,
        orbitRadius: isGroup ? graphRadius * 0.3 : orbitRadius,
        fx: isGroup ? anchor?.x : undefined,
        fy: isGroup ? anchor?.y : undefined,
      };
    }) as SimulationNode[];
    const links = data.links.map((item) => ({ ...item })) as any[];
    const degree = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    data.nodes.forEach((item) => {
      if (item.group && item.kind !== "group") groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
    });
    data.links.forEach(({ source, target }) => {
      degree.set(compactNotionId(source), (degree.get(compactNotionId(source)) || 0) + 1);
      degree.set(compactNotionId(target), (degree.get(compactNotionId(target)) || 0) + 1);
    });
    const link = viewport.append("g").attr("class", "knowledge-graph-links")
      .selectAll("path").data(links).join("path")
      .attr("class", (item: any) => `is-${item.kind || "reference"}`)
      .attr("data-source", (item: any) => compactNotionId(item.source))
      .attr("data-target", (item: any) => compactNotionId(item.target));
    const highlightConnections = (_event: any, item: SimulationNode) => {
      const key = compactNotionId(item.id);
      link.classed("is-highlighted", (edge: any) => {
        const source = compactNotionId(edge.source?.id || edge.source);
        const target = compactNotionId(edge.target?.id || edge.target);
        return source === key || target === key;
      }).classed("is-dimmed", (edge: any) => {
        const source = compactNotionId(edge.source?.id || edge.source);
        const target = compactNotionId(edge.target?.id || edge.target);
        return source !== key && target !== key;
      });
    };
    const clearHighlightedConnections = () => link.classed("is-highlighted", false).classed("is-dimmed", false);
    const node = viewport.append("g").attr("class", "knowledge-graph-nodes")
      .selectAll("g")
      .data(nodes).join("g")
      .attr("class", (item) => {
        const key = compactNotionId(item.id);
        return `knowledge-graph-node is-${item.kind || "reference"} ${item.group ? `is-group-${item.group}` : ""} ${key === activeKey ? "is-active" : ""}`;
      })
      .attr("tabindex", 0)
      .attr("role", "link")
      .attr("aria-label", (item) => item.title)
      .on("click", (event, item) => {
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { window.open(item.href, "_blank", "noopener,noreferrer"); return; }
        if (!navigateRef.current?.(item.href, item.title)) window.location.assign(item.href);
      })
      .on("mouseenter", highlightConnections)
      .on("focus", highlightConnections)
      .on("mouseleave", clearHighlightedConnections)
      .on("blur", clearHighlightedConnections)
      .on("keydown", (event, item) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!navigateRef.current?.(item.href, item.title)) window.location.assign(item.href);
        }
      });

    node.append("circle").attr("r", (item) => {
      if (item.kind === "group") return variant === "compact" ? 10 : 16;
      const connections = degree.get(compactNotionId(item.id)) || 0;
      const base = variant === "compact" ? 6 : 7;
      return compactNotionId(item.id) === activeKey ? base + 5 : base + Math.min(4, connections * 0.7);
    });
    node.append("title").text((item) => item.title);
    node.append("text").attr("x", 11).attr("y", 4).text((item) => {
      const limit = variant === "compact" ? 18 : 28;
      return item.title.length > limit ? `${item.title.slice(0, limit)}…` : item.title;
    });

    const groupOrder = ["post", "project", "recap", "document"] as const;
    const candidatesByGroup = groupOrder.map((group) => nodes
      .filter((item) => item.group === group && item.kind !== "group")
      .sort((a, b) => (degree.get(compactNotionId(b.id)) || 0) - (degree.get(compactNotionId(a.id)) || 0)));
    const labelCandidates: SimulationNode[] = [];
    const longestGroup = Math.max(...candidatesByGroup.map((items) => items.length), 0);
    for (let index = 0; index < longestGroup; index += 1) {
      candidatesByGroup.forEach((items) => { if (items[index]) labelCandidates.push(items[index]); });
    }
    labelCandidates.push(...nodes.filter((item) => !item.group && item.kind !== "group")
      .sort((a, b) => (degree.get(compactNotionId(b.id)) || 0) - (degree.get(compactNotionId(a.id)) || 0)));

    let currentTransform = d3.zoomIdentity;
    const updateLabelVisibility = (transform: any) => {
      if (variant === "compact") {
        node.classed("is-label-visible", true);
        return;
      }
      const scale = transform.k || 1;
      const maxLabels = scale < 0.75 ? 28 : scale < 1 ? 48 : scale < 1.5 ? 82 : scale < 2.2 ? 140 : nodes.length;
      const gap = scale < 1 ? 10 : 6;
      const visible = new Set<string>();
      const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      const reserve = (item: SimulationNode, force = false) => {
        const key = compactNotionId(item.id);
        const x = transform.applyX(item.x || 0) + 12;
        const y = transform.applyY(item.y || 0);
        const width = Math.min(190, Math.max(34, item.title.length * 6.4));
        const rectangle = { left: x - gap, right: x + width + gap, top: y - 10 - gap, bottom: y + 8 + gap };
        const overlaps = occupied.some((other) => rectangle.left < other.right && rectangle.right > other.left
          && rectangle.top < other.bottom && rectangle.bottom > other.top);
        if (!force && overlaps) return false;
        visible.add(key);
        occupied.push(rectangle);
        return true;
      };

      nodes.filter((item) => item.kind === "group" || compactNotionId(item.id) === activeKey)
        .forEach((item) => reserve(item, true));
      for (const item of labelCandidates) {
        if (visible.size >= maxLabels) break;
        reserve(item);
      }
      node.classed("is-label-visible", (item) => visible.has(compactNotionId(item.id)));
    };
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((item: any) => item.id)
        .distance((item: any) => {
          if (variant === "compact") return 68;
          if (item.kind !== "membership") return 160;
          const group = item.target?.group || item.source?.group;
          return Math.min(245, 72 + Math.sqrt(groupCounts.get(group) || 1) * 13);
        })
        .strength((item: any) => item.kind === "membership" ? 0.72 : 0.14))
      .force("charge", d3.forceManyBody().strength(variant === "compact" ? -130 : -300))
      .force("center", d3.forceCenter(center.x, center.y))
      .force("collision", d3.forceCollide().radius((item: any) => item.kind === "group" ? 62 : variant === "compact" ? 24 : 38));

    link.classed("is-cross-group", (item: any) => item.kind === "reference"
      && item.source?.group
      && item.target?.group
      && item.source.group !== item.target.group);
    groupOrder.forEach((group) => {
      link.classed(`is-membership-${group}`, (item: any) => item.kind === "membership"
        && (item.source?.group === group || item.target?.group === group));
    });

    if (variant === "full") {
      simulation
        .force("cluster-x", d3.forceX((item: SimulationNode) => item.group ? clusterAnchors[item.group].x : size.width / 2)
          .strength((item: SimulationNode) => item.kind === "group" ? 1 : item.group ? 0.045 : 0.02))
        .force("cluster-y", d3.forceY((item: SimulationNode) => item.group ? clusterAnchors[item.group].y : size.height / 2)
          .strength((item: SimulationNode) => item.kind === "group" ? 1 : item.group ? 0.045 : 0.02))
        .force("radial-shell", d3.forceRadial((item: SimulationNode) => item.orbitRadius || 0, center.x, center.y)
          .strength((item: SimulationNode) => item.kind === "group" ? 0 : 0.12));
    }

    let viewChanged = false;
    node.call(d3.drag()
      .on("start", (event, item) => {
        viewChanged = true;
        if (!event.active) simulation.alphaTarget(0.25).restart();
        item.fx = item.x;
        item.fy = item.y;
      })
      .on("drag", (event, item) => {
        item.fx = event.x;
        item.fy = event.y;
      })
      .on("end", (event, item) => {
        if (!event.active) simulation.alphaTarget(0);
        item.fx = item.kind === "group" ? item.anchorX : null;
        item.fy = item.kind === "group" ? item.anchorY : null;
      }));

    let labelTick = 0;
    const renderPositions = () => {
      link.attr("d", (item: any) => {
        const source = item.source as SimulationNode;
        const target = item.target as SimulationNode;
        if (item.kind === "reference" && source.group && target.group && source.group !== target.group) {
          const sourceAnchor = clusterAnchors[source.group];
          const targetAnchor = clusterAnchors[target.group];
          return `M${source.x || 0},${source.y || 0} C${sourceAnchor.x},${sourceAnchor.y} ${targetAnchor.x},${targetAnchor.y} ${target.x || 0},${target.y || 0}`;
        }
        return `M${source.x || 0},${source.y || 0} L${target.x || 0},${target.y || 0}`;
      });
      node.attr("transform", (item) => `translate(${item.x || 0},${item.y || 0})`);
      labelTick += 1;
      if (labelTick % 12 === 0) updateLabelVisibility(currentTransform);
    };
    simulation.on("tick", renderPositions);

    // Resolve the initial layout before the browser paints it. Later drag interactions restart the simulation.
    simulation.stop();
    simulation.tick(280);
    renderPositions();

    if (variant === "full") {
      const zoom = d3.zoom().scaleExtent([0.5, 3])
        .on("zoom", (event) => {
          currentTransform = event.transform;
          viewport.attr("transform", event.transform);
          node.selectAll("text").attr("transform", `scale(${1 / event.transform.k})`);
          updateLabelVisibility(currentTransform);
        });
      svg.call(zoom);
      const positioned = nodes.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
      if (positioned.length) {
        const sortedX = positioned.map((item) => item.x as number).sort((a, b) => a - b);
        const sortedY = positioned.map((item) => item.y as number).sort((a, b) => a - b);
        const trim = Math.floor(positioned.length * 0.02);
        const minX = sortedX[trim];
        const maxX = sortedX[sortedX.length - trim - 1];
        const minY = sortedY[trim];
        const maxY = sortedY[sortedY.length - trim - 1];
        const padding = 70;
        const graphWidth = Math.max(1, maxX - minX + padding * 2);
        const graphHeight = Math.max(1, maxY - minY + padding * 2);
        const scale = Math.max(0.65, Math.min(0.95, size.width / graphWidth, size.height / graphHeight));
        const translateX = size.width / 2 - scale * ((minX + maxX) / 2);
        const translateY = size.height / 2 - scale * ((minY + maxY) / 2);
        svg.call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
      }
    } else {
      updateLabelVisibility(currentTransform);
      const zoom = d3.zoom()
        .scaleExtent([0.01, 3])
        // This graph sits inside an article: the wheel must keep scrolling it.
        .filter((event) => event.type !== 'wheel' && event.type !== 'dblclick' && !event.button)
        .on('start', (event) => { if (event.sourceEvent) viewChanged = true; })
        .on('zoom', (event) => {
          currentTransform = event.transform;
          viewport.attr('transform', event.transform);
        });
      svg.call(zoom).on('dblclick.zoom', null);
      const fit = () => {
        const bounds = viewport.node()?.getBBox();
        if (!bounds) return;
        const { x, y, k } = fitGraphBounds(bounds, size.width, size.height);
        svg.call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
      };
      resetViewRef.current = fit;
      fit();
      // A late webfont can change label widths after the initial measurement.
      let disposed = false;
      document.fonts?.ready.then(() => { if (!disposed && !viewChanged) fit(); });
      return () => {
        disposed = true;
        resetViewRef.current = null;
        svg.on('.zoom', null);
        simulation.stop();
      };
    }

    return () => { svg.on('.zoom', null); simulation.stop(); };
  }, [activeId, data, size, variant]);

  return (
    <div ref={hostRef} className={`knowledge-graph knowledge-graph-${variant} ${className}`}>
      <svg ref={svgRef} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} aria-label="이야기 연결 그래프" />
      {variant === 'compact' && data.nodes.length > 0 && <button
        type="button" className="knowledge-graph-reset"
        aria-label="그래프 위치 초기화" title="그래프 위치 초기화"
        onClick={() => resetViewRef.current?.()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 10a8 8 0 1 0 .5 5M20 4v6h-6" />
        </svg>
      </button>}
    </div>
  );
}
