/** Public article data. Timestamps and revisions are assigned by the server. */
export type ArticleOrganization = {
	category?: string;
	tags?: string[];
	series?: string;
	seriesOrder?: number;
};

export type OnlinePost = ArticleOrganization & {
	id: string;
	title: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	revision: number;
	html?: string;
};

export type SaveOnlinePost = ArticleOrganization & {
	id: string;
	title: string;
	body: string;
	/** Prevent an older browser tab from silently replacing a newer edit. */
	revision: number;
};
