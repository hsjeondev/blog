import { notionId } from './notion-server';

export function propertyText(property: any) {
  return (property?.title || property?.rich_text || []).map((part: any) => part.plain_text || part.text?.content || '').join('');
}

export function publicationKind(page: any): 'post' | 'document' | 'project' | 'recap' {
  const kind = page.properties?.['유형']?.select?.name || page.properties?.['forest_분류']?.select?.name;
  return kind === '문서' ? 'document' : kind === '프로젝트' ? 'project' : kind === '일지' || kind === '월말결산' ? 'recap' : 'post';
}

export function bookMetadata(page: any) {
  const props = page.properties || {};
  const titleProperty = props['책제목'] || Object.values(props).find((p: any) => p.type === 'title');
  return {
    id: notionId(page.id), title: propertyText(titleProperty) || '제목 없는 기록', author: propertyText(props['저자']),
    category: props['분류']?.select?.name || props['카테고리']?.select?.name || '독서',
    tags: (props['태그']?.multi_select || []).map((tag: any) => ({ id: tag.id || tag.name, name: tag.name })),
    date: props['작성일']?.date?.start || props['발행일']?.date?.start || props['forest_날짜']?.date?.start || page.created_time,
    createdTime: page.created_time, lastEditedTime: page.last_edited_time, cover: page.cover || null, icon: page.icon || null,
    description: propertyText(props['설명']), folderPath: propertyText(props['forest_폴더']) || props['forest_폴더']?.select?.name || '', kind: publicationKind(page),
  };
}

export function siteUrl() {
  return new URL(process.env.NEXT_PUBLIC_URL || 'https://blog.jeonhongshik.com').origin;
}
