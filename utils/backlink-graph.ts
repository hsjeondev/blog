export type BacklinkSource = {
  id: string;
  title: string;
  href: string;
};

export const compactNotionId = (id = "") => id.replace(/-/g, "").toLowerCase();

export function blockValue(entry: any) {
  if (entry?.value?.value && entry.value.role) return entry.value.value;
  return entry?.value || entry;
}

export function resolveBacklinkSources(payload: any): BacklinkSource[] {
  if (Array.isArray(payload?.sources)) return payload.sources;
  const backlinks = Array.isArray(payload?.backlinks) ? payload.backlinks : [];
  const blocks = payload?.recordMap?.block || {};
  const sources = new Map<string, BacklinkSource>();

  backlinks.forEach((backlink: any) => {
    const mentionId = backlink?.mentioned_from?.block_id;
    let current = blockValue(blocks[mentionId]);
    const visited = new Set<string>();

    while (current?.id && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.type === "page") {
        const title = current.properties?.title?.[0]?.[0] || "제목 없는 문서";
        const key = compactNotionId(current.id);
        sources.set(key, {
          id: current.id,
          title: String(title),
          href: `/${current.id}#${compactNotionId(mentionId)}`,
        });
        break;
      }
      current = blockValue(blocks[current.parent_id]);
    }
  });

  return [...sources.values()];
}
