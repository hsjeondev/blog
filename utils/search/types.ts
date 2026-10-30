export const SEARCH_SCOPES = ["all", "document", "post", "project", "recap"] as const;
export type SearchScope = typeof SEARCH_SCOPES[number];
export type SearchResult = {
  id: string;
  title: string;
  author?: string;
  category?: string;
  type: Exclude<SearchScope, "all">;
  folderPath: string;
  href: string;
  excerpt?: string;
  createdTime: string;
  lastEditedTime: string;
};
export type SearchOptions = { scope?: SearchScope; folder?: string };
export const scopeLabels: Record<SearchScope, string> = {
  all: "전체", document: "문서", post: "포스트", project: "프로젝트", recap: "월말결산",
};
export function isSearchScope(value: unknown): value is SearchScope {
  return SEARCH_SCOPES.includes(value as SearchScope);
}
