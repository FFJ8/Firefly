import type { SearchResult } from "@/global";

type OnlineSearchResult = { url: string; title: string; excerpt: string };
type DynamicSearchEntry = { id: string; searchText: string };

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function highlight(value: string, query: string): string {
	const index = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
	if (index < 0) return escapeHtml(value);
	return `${escapeHtml(value.slice(0, index))}<mark>${escapeHtml(value.slice(index, index + query.length))}</mark>${escapeHtml(value.slice(index + query.length))}`;
}

/** Combine live articles with the static page index. Either source can still return results if the other fails. */
export async function searchSite(query: string): Promise<SearchResult[]> {
	const keyword = query.trim();
	if (!keyword) return [];
	const online = async (): Promise<SearchResult[]> => {
		const response = await fetch(`/api/blog/search?q=${encodeURIComponent(keyword)}`, { cache: "no-store" });
		if (!response.ok) throw new Error("在线文章搜索失败");
		const data = await response.json() as { results: OnlineSearchResult[] };
		return data.results.map((item) => ({ url: item.url, meta: { title: highlight(item.title, keyword) }, excerpt: highlight(item.excerpt, keyword) }));
	};
	const staticPages = async (): Promise<SearchResult[]> => {
		if (import.meta.env.DEV) return [];
		await window.__loadPagefind?.();
		if (!window.pagefind) return [];
		const response = await window.pagefind.search(keyword);
		return Promise.all(response.results.map((item) => item.data()));
	};
	const dynamics = async (): Promise<SearchResult[]> => {
		const response = await fetch("/api/dynamic.json");
		if (!response.ok) throw new Error("动态搜索失败");
		const entries = await response.json() as DynamicSearchEntry[];
		return entries.filter((entry) => entry.searchText.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
			.map((entry) => ({ url: `/dynamic/#dynamic-${encodeURIComponent(entry.id)}`, meta: { title: "动态" }, excerpt: highlight(entry.searchText, keyword) }));
	};
	const [articles, pages, dynamicEntries] = await Promise.allSettled([online(), staticPages(), dynamics()]);
	if (articles.status === "rejected" && pages.status === "rejected" && dynamicEntries.status === "rejected") throw new Error("搜索暂时不可用");
	const results = [
		...(articles.status === "fulfilled" ? articles.value : []),
		...(pages.status === "fulfilled" ? pages.value : []),
		...(dynamicEntries.status === "fulfilled" ? dynamicEntries.value : []),
	];
	return results.filter((result, index) => results.findIndex((item) => item.url === result.url) === index);
}
