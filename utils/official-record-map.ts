import { notionId, notionRequest } from './notion-server';
import { bookMetadata } from './published-notion';

// Convert only the selected published page's own blocks. No ancestors, users,
// linked databases, private child pages or foreign synced blocks are fetched.
export async function officialRecordMap(page: any, catalog: ReturnType<typeof bookMetadata>[], signal?: AbortSignal) {
  const allowed = new Map(catalog.map((item) => [item.id, item]));
  const map: any = { block: {}, collection: {}, collection_view: {}, collection_query: {}, notion_user: {}, signed_urls: {} };
  const references = new Set<string>();
  const meta = bookMetadata(page);
  const entry = (value: any) => ({ role: 'reader', value });
  const pageValue = (item: typeof meta) => ({ id: item.id, type: 'page', alive: true, parent_id: '', parent_table: 'space',
    created_time: Date.parse(item.createdTime), last_edited_time: Date.parse(item.lastEditedTime),
    properties: { title: [[item.title]] }, format: {}, blog_metadata: item });
  map.block[meta.id] = entry({ ...pageValue(meta), content: [], format: {
    page_icon: page.icon?.emoji || page.icon?.file?.url || page.icon?.external?.url,
    page_cover: page.cover?.file?.url || page.cover?.external?.url,
  } });

  const addReference = (value: string) => {
    const id = notionId(value);
    const target = allowed.get(id);
    if (!target) return '';
    if (id !== meta.id) references.add(id);
    if (!map.block[id]) map.block[id] = entry(pageValue(target));
    return id;
  };
  const internalTarget = (value: string): string | null => {
    try {
      const url = new URL(value, process.env.NEXT_PUBLIC_URL || 'https://blog.jeonhongshik.com');
      const ownHost = new URL(process.env.NEXT_PUBLIC_URL || 'https://blog.jeonhongshik.com').hostname;
      if (!(url.hostname === ownHost || /(^|\.)notion\.(so|site|com)$/.test(url.hostname))) return null;
      const match = url.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i);
      return match ? notionId(match[1]) : null;
    } catch { return null; }
  };
  const safeLink = (value: string) => {
    const target = internalTarget(value);
    if (target !== null) return addReference(target) ? '/' + target : '';
    try { return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value).protocol) ? value : ''; } catch { return ''; }
  };
  const richText = (parts: any[] = []): any[] => parts.map((part) => {
    const annotations: any[] = [];
    let text = part.plain_text || part.text?.content || '';
    if (part.type === 'mention' && (part.mention?.page || part.mention?.database || part.mention?.data_source)) {
      const id = part.mention.page && addReference(part.mention.page.id);
      if (!id) return ['[비공개 문서]'];
      text = allowed.get(id)!.title;
      annotations.push(['p', id]);
    } else if (part.type === 'mention' && part.mention?.date) {
      text = part.mention.date.start;
    } else if (part.type === 'equation') {
      text = part.equation.expression;
      annotations.push(['e', text]);
    }
    const link = part.href || part.text?.link?.url;
    if (link && part.type !== 'mention') {
      const safe = safeLink(link);
      if (!safe) return ['[비공개 문서]'];
      annotations.push(['a', safe]);
    }
    const a = part.annotations || {};
    for (const [key, code] of [['bold', 'b'], ['italic', 'i'], ['strikethrough', 's'], ['underline', '_'], ['code', 'c']]) if (a[key]) annotations.push([code]);
    if (a.color && a.color !== 'default') annotations.push(['h', a.color.replace('green', 'teal')]);
    return annotations.length ? [text, annotations] : [text];
  });
  let visitedCount = 0;
  const visited = new Set<string>();
  const pending = [{ parentId: meta.id, depth: 0 }];
  const children = async (parentId: string, depth: number): Promise<string[]> => {
    if (depth > 100) throw new Error('Notion document nesting limit exceeded');
    const result: string[] = [];
    let cursor: string | undefined;
    do {
      const data = await notionRequest('blocks/' + parentId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''), undefined, signal);
      for (const raw of data.results || []) {
        const id = notionId(raw.id);
        if (!id || raw.archived || raw.in_trash || visited.has(id)) continue;
        if (++visitedCount > 10000) throw new Error('Notion document block limit exceeded');
        visited.add(id);
        const source = raw[raw.type] || {};
        const value: any = { id, type: raw.type, alive: true, parent_id: parentId, parent_table: 'block',
          created_time: Date.parse(raw.created_time), last_edited_time: Date.parse(raw.last_edited_time), properties: {}, format: {} };
        let descend = !!raw.has_children;
        const aliases: Record<string, string> = { paragraph: 'text', heading_1: 'header', heading_2: 'sub_header', heading_3: 'sub_sub_header', bulleted_list_item: 'bulleted_list', numbered_list_item: 'numbered_list' };
        value.type = aliases[raw.type] || raw.type;
        if (source.rich_text) value.properties.title = richText(source.rich_text);
        if (source.color && source.color !== 'default') value.format.block_color = source.color.replace('green', 'teal');
        if (source.is_toggleable) value.format.toggleable = true;
        if (raw.type === 'to_do') value.properties.checked = [[source.checked ? 'Yes' : 'No']];
        if (raw.type === 'code') value.properties.language = [[source.language || 'Plain Text']];
        if (source.caption?.length) value.properties.caption = richText(source.caption);
        if (raw.type === 'equation') value.properties.title = [[source.expression || '']];
        if (raw.type === 'callout') value.format.page_icon = source.icon?.emoji || source.icon?.file?.url || source.icon?.external?.url;
        if (['child_database', 'child_page', 'link_to_page'].includes(raw.type)) {
          const target = raw.type === 'child_page' ? raw.id : source.page_id;
          const linked = target && addReference(target);
          if (!linked) continue;
          value.type = 'text'; value.properties.title = [[allowed.get(linked)!.title, [['p', linked]]]]; descend = false;
        }
        if (raw.type === 'synced_block') {
          if (source.synced_from) continue;
          value.type = 'transclusion_container';
        }
        if (raw.type === 'table') value.format = {
          table_block_column_order: Array.from({ length: source.table_width }, (_, i) => 'column_' + i),
          table_block_column_header: !!source.has_column_header, table_block_row_header: !!source.has_row_header,
        };
        if (raw.type === 'table_row') value.properties = Object.fromEntries((source.cells || []).map((cell: any[], i: number) => ['column_' + i, richText(cell)]));
        if (raw.type === 'column') value.format.column_ratio = 0.5;
        if (['image', 'video', 'audio', 'file', 'pdf', 'embed', 'bookmark'].includes(raw.type)) {
          const url = safeLink(source.file?.url || source.external?.url || source.url || '');
          if (!url) continue;
          value.properties.source = [[url]];
          if (raw.type === 'bookmark') { value.properties.link = [[url]]; value.properties.title = [[url]]; }
          if (raw.type === 'file') value.properties.title = [[source.name || '첨부 파일']];
          map.signed_urls[id] = url;
        }
        const supported = new Set(['text', 'header', 'sub_header', 'sub_sub_header', 'bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'callout', 'divider', 'code', 'equation', 'image', 'video', 'audio', 'file', 'pdf', 'embed', 'bookmark', 'table', 'table_row', 'column_list', 'column', 'table_of_contents', 'transclusion_container']);
        if (!supported.has(value.type)) { value.type = 'text'; value.properties = { title: [['이 콘텐츠는 아직 표시할 수 없습니다.']] }; descend = false; }
        map.block[id] = entry(value);
        result.push(id);
        if (descend) pending.push({ parentId: id, depth: depth + 1 });
      }
      cursor = data.has_more ? data.next_cursor : undefined;
      if (data.has_more && !cursor) throw new Error('Incomplete Notion block pagination');
    } while (cursor);
    return result;
  };
  // Read sibling subtrees together, with at most two block requests in flight.
  // Each parent's pagination and content array retain their original order.
  while (pending.length) {
    const batch = pending.splice(0, 2);
    await Promise.all(batch.map(async ({ parentId, depth }) => {
      map.block[parentId].value.content = await children(parentId, depth);
    }));
  }
  // IDs here are drawn exclusively from the public catalog, for graph/search use.
  map.published_references = [...references];
  return JSON.parse(JSON.stringify(map));
}
