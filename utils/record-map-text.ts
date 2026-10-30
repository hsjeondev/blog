export function searchableBody(map: any, pageId: string) {
  const parts: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, root = false) => {
    if (visited.has(id)) return;
    visited.add(id);
    const block = map.block?.[id]?.value;
    if (!block || (!root && ['page', 'collection_view_page'].includes(block.type))) return;
    if (!root) {
      const rich = (value: any[]) => (value || []).filter(part => !(part[1] || []).some((a: any[]) => a[0] === 'p' || (a[0] === 'a' && /^\/[a-f0-9-]{32,36}$/.test(a[1] || '')))).map(part => part[0] || '').join('');
      for (const [key, value] of Object.entries(block.properties || {})) {
        if (key === 'title' || key.startsWith('column_')) parts.push(rich(value as any[]));
      }
    }
    for (const child of block.content || []) visit(child);
  };
  visit(pageId, true);
  return parts.join('\n').trim();
}

