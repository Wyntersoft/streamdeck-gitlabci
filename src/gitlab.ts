/**
 * Minimal GitLab REST client for reading pipeline status.
 */

export type PipelineStatus =
	| "created"
	| "waiting_for_resource"
	| "preparing"
	| "pending"
	| "running"
	| "success"
	| "failed"
	| "canceling"
	| "canceled"
	| "skipped"
	| "manual"
	| "scheduled";

export type Pipeline = {
	id: number;
	status: PipelineStatus;
	ref: string;
	sha: string;
	webUrl: string;
	createdAt?: string;
	startedAt?: string;
	finishedAt?: string;
	updatedAt?: string;
	duration?: number;
};

export type ProjectQuery = {
	/** Base URL of the GitLab instance, e.g. https://gitlab.com */
	baseUrl: string;
	/** Personal/project access token with `read_api` scope. Optional for public projects. */
	token?: string;
	/** Project path (`group/project`) or numeric ID. */
	project: string;
	/** Branch or tag; the project's default branch when omitted. */
	ref?: string;
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type GitLabErrorKind = "auth" | "not-found" | "no-pipeline" | "http" | "network";

export class GitLabError extends Error {
	readonly kind: GitLabErrorKind;
	readonly status?: number;

	constructor(message: string, kind: GitLabErrorKind, status?: number) {
		super(message);
		this.kind = kind;
		this.status = status;
	}
}

/**
 * Normalises user input for the GitLab instance URL: adds a scheme, strips trailing slashes and `/api/v4`.
 */
export function normalizeBaseUrl(input: string | undefined): string {
	let url = (input ?? "").trim() || "https://gitlab.com";
	if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
	return url.replace(/\/+$/, "").replace(/\/api\/v4$/i, "");
}

/**
 * Accepts `group/project`, a numeric ID, or a full project/pipeline URL pasted from the browser, and returns the
 * project path or ID. When a URL is given, its origin is also returned so it can stand in for the instance URL.
 */
export function parseProject(input: string): { project: string; baseUrl?: string } {
	const value = input.trim();
	if (/^https?:\/\//i.test(value)) {
		const url = new URL(value);
		// Anything after "/-/" is a sub-page (pipelines, merge_requests, ...).
		const path = url.pathname.split("/-/")[0].replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
		return { project: path, baseUrl: url.origin };
	}
	return { project: value.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "") };
}

/**
 * Fetches the latest pipeline for the project's ref (default branch when no ref is given).
 */
export async function fetchLatestPipeline(query: ProjectQuery, fetchFn: FetchFn = fetch): Promise<Pipeline> {
	const baseUrl = normalizeBaseUrl(query.baseUrl);
	const params = new URLSearchParams();
	if (query.ref?.trim()) params.set("ref", query.ref.trim());

	const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(query.project)}/pipelines/latest${params.size ? `?${params}` : ""}`;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (query.token?.trim()) headers["PRIVATE-TOKEN"] = query.token.trim();

	let res: Response;
	try {
		res = await fetchFn(url, { headers, signal: AbortSignal.timeout(15_000) });
	} catch (err) {
		throw new GitLabError(`Network error: ${(err as Error).message}`, "network");
	}

	if (!res.ok) {
		const body = (await res.json().catch(() => undefined)) as { message?: unknown; error?: unknown } | undefined;
		const message = String(body?.message ?? body?.error ?? res.statusText);
		if (res.status === 401 || body?.error === "insufficient_scope") throw new GitLabError(message, "auth", res.status);
		// GitLab answers 403 for a readable project whose ref has never had a pipeline.
		if (res.status === 403) throw new GitLabError(message, "no-pipeline", res.status);
		if (res.status === 404) {
			// GitLab answers 404 both for unknown/inaccessible projects and for refs that have no pipeline.
			const kind = /project/i.test(message) ? "not-found" : "no-pipeline";
			throw new GitLabError(message, kind, res.status);
		}
		throw new GitLabError(message, "http", res.status);
	}

	const p = (await res.json()) as Record<string, unknown>;
	return {
		id: p.id as number,
		status: p.status as PipelineStatus,
		ref: p.ref as string,
		sha: p.sha as string,
		webUrl: p.web_url as string,
		createdAt: (p.created_at as string | null) ?? undefined,
		startedAt: (p.started_at as string | null) ?? undefined,
		finishedAt: (p.finished_at as string | null) ?? undefined,
		updatedAt: (p.updated_at as string | null) ?? undefined,
		duration: (p.duration as number | null) ?? undefined,
	};
}

/** Statuses for which the pipeline is still in progress and should be polled more often. */
export function isActive(status: PipelineStatus): boolean {
	return ["created", "waiting_for_resource", "preparing", "pending", "running", "canceling"].includes(status);
}
