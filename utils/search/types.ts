export const SEARCH_SCOPES = ["all", "books", "writing", "document", "post", "project", "recap"] as const;
export const SEARCH_TABS = ["all", "books", "writing"] as const;
export type SearchScope = typeof SEARCH_SCOPES[number];
export type SearchResult = {
  id: string;
  title: string;
  author?: string;
  category?: string;
  type: 'document' | 'post' | 'project' | 'recap';
  source?: 'books' | 'writing';
  folderPath: string;
  href: string;
  excerpt?: string;
  createdTime: string;
  lastEditedTime: string;
};
export type SearchOptions = { scope?: SearchScope; folder?: string };
export const scopeLabels: Record<SearchScope, string> = {
  all: "전체", books: "책 이야기", writing: "글 이야기", document: "문서", post: "포스트", project: "프로젝트", recap: "월말결산",
};
export function matchesSearchScope(item: SearchResult, scope: SearchScope) {
  if (scope === 'books' || scope === 'writing') return item.type === 'post' && item.source === scope;
  return scope === 'all' || item.type === scope;
}
export function isSearchScope(value: unknown): value is SearchScope {
  return SEARCH_SCOPES.includes(value as SearchScope);
}
