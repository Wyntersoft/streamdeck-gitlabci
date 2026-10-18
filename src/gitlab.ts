/**
 * Minimal GitLab REST client for pipelines and runners.
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
	/** True when the pipeline passed but jobs allowed to fail did fail. */
	warnings: boolean;
	ref: string;
	sha: string;
	webUrl: string;
	createdAt?: string;
	startedAt?: string;
	finishedAt?: string;
	updatedAt?: string;
	duration?: number;
};

export type Runner = {
	id: number;
	name: string;
	status: "online" | "offline" | "stale" | "never_contacted" | string;
	paused: boolean;
	/** True while the runner is executing at least one job. */
	busy: boolean;
	type: string;
};

export type RunnerFleet = {
	total: number;
	online: number;
	busy: number;
	/** Jobs waiting for a runner; undefined when the token can't see instance-wide jobs (non-admin). */
	queued?: number;
};

export type RunnerJob = {
	id: number;
	name: string;
	stage: string;
	ref: string;
	project: string;
	startedAt?: string;
	webUrl: string;
};

export type Connection = {
	/** Base URL of the GitLab instance, e.g. https://gitlab.com */
	baseUrl: string;
	/** Personal/project access token. Optional for reading public projects. */
	token?: string;
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type GitLabErrorKind = "auth" | "forbidden" | "not-found" | "no-pipeline" | "http" | "network";

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

async function request<T>(conn: Connection, method: "GET" | "POST", path: string, fetchFn: FetchFn, body?: unknown): Promise<T> {
	const url = `${normalizeBaseUrl(conn.baseUrl)}/api/${path}`;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (conn.token?.trim()) headers["PRIVATE-TOKEN"] = conn.token.trim();
	if (body !== undefined) headers["Content-Type"] = "application/json";

	let res: Response;
	try {
		res = await fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
	} catch (err) {
		throw new GitLabError(`Network error: ${(err as Error).message}`, "network");
	}

	if (!res.ok) {
		const body = (await res.json().catch(() => undefined)) as { message?: unknown; error?: unknown } | undefined;
		const message = String(body?.message ?? body?.error ?? res.statusText);
		if (res.status === 401 || body?.error === "insufficient_scope") throw new GitLabError(message, "auth", res.status);
		if (res.status === 403) throw new GitLabError(message, "forbidden", res.status);
		if (res.status === 404) throw new GitLabError(message, "not-found", res.status);
		throw new GitLabError(message, "http", res.status);
	}
	return (await res.json()) as T;
}

const project = (id: string) => `v4/projects/${encodeURIComponent(id)}`;

function toPipeline(p: Record<string, unknown>): Pipeline {
	const detailed = p.detailed_status as { group?: string } | undefined;
	return {
		id: p.id as number,
		status: p.status as PipelineStatus,
		warnings: detailed?.group === "success-with-warnings",
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

/**
 * Fetches the latest pipeline for the project's ref (default branch when no ref is given).
 */
export async function fetchLatestPipeline(conn: Connection, projectId: string, ref?: string, fetchFn: FetchFn = fetch): Promise<Pipeline> {
	const query = ref?.trim() ? `?${new URLSearchParams({ ref: ref.trim() })}` : "";
	try {
		return toPipeline(await request(conn, "GET", `${project(projectId)}/pipelines/latest${query}`, fetchFn));
	} catch (err) {
		// For a readable project whose ref has no pipeline GitLab answers 403 (or 404 without "Project" in the message).
		if (err instanceof GitLabError && (err.kind === "forbidden" || (err.kind === "not-found" && !/project/i.test(err.message)))) {
			throw new GitLabError(err.message, "no-pipeline", err.status);
		}
		throw err;
	}
}

/** Retries the failed and canceled jobs of a pipeline. Requires a token with `api` scope. */
export async function retryPipeline(conn: Connection, projectId: string, pipelineId: number, fetchFn: FetchFn = fetch): Promise<Pipeline> {
	return toPipeline(await request(conn, "POST", `${project(projectId)}/pipelines/${pipelineId}/retry`, fetchFn));
}

/** Cancels the running and pending jobs of a pipeline. Requires a token with `api` scope. */
export async function cancelPipeline(conn: Connection, projectId: string, pipelineId: number, fetchFn: FetchFn = fetch): Promise<Pipeline> {
	return toPipeline(await request(conn, "POST", `${project(projectId)}/pipelines/${pipelineId}/cancel`, fetchFn));
}

function toRunner(r: Record<string, unknown>): Runner {
	const description = (r.description as string | null)?.trim();
	return {
		id: r.id as number,
		name: description || (r.name as string | null) || `Runner #${r.id}`,
		status: r.status as string,
		paused: (r.paused as boolean | undefined) ?? r.active === false,
		busy: r.job_execution_status === "active",
		type: r.runner_type as string,
	};
}

export async function fetchRunner(conn: Connection, runnerId: string, fetchFn: FetchFn = fetch): Promise<Runner> {
	return toRunner(await request(conn, "GET", `v4/runners/${encodeURIComponent(runnerId)}`, fetchFn));
}

/**
 * Lists the runners the token can see: every runner for administrators, otherwise those owned by the user.
 */
export async function listRunners(conn: Connection, fetchFn: FetchFn = fetch): Promise<Runner[]> {
	let runners: Record<string, unknown>[];
	try {
		runners = await request(conn, "GET", "v4/runners/all?per_page=100", fetchFn);
	} catch (err) {
		if (!(err instanceof GitLabError && err.kind === "forbidden")) throw err;
		runners = await request(conn, "GET", "v4/runners?per_page=100", fetchFn);
	}
	return runners.map(toRunner);
}

/**
 * Summarises every runner the token can see, plus the number of jobs waiting for a runner. The queue depth needs an
 * administrator token; for other tokens it is left undefined.
 */
export async function fetchRunnerFleet(conn: Connection, fetchFn: FetchFn = fetch): Promise<RunnerFleet> {
	const [runners, queued] = await Promise.all([
		listRunners(conn, fetchFn),
		request<{ data?: { jobs?: { count?: number } | null } }>(conn, "POST", "graphql", fetchFn, { query: "{ jobs(statuses: [PENDING]) { count } }" })
			.then((res) => res.data?.jobs?.count ?? undefined)
			.catch(() => undefined),
	]);
	const online = runners.filter((r) => r.status === "online" && !r.paused);
	return { total: runners.length, online: online.length, busy: online.filter((r) => r.busy).length, queued };
}

/** Jobs the runner is currently executing. */
export async function fetchRunnerJobs(conn: Connection, runnerId: string, fetchFn: FetchFn = fetch): Promise<RunnerJob[]> {
	const jobs = await request<Record<string, unknown>[]>(conn, "GET", `v4/runners/${encodeURIComponent(runnerId)}/jobs?status=running&order_by=id&sort=desc`, fetchFn);
	return jobs.map((j) => {
		const proj = j.project as { name?: string; path_with_namespace?: string } | undefined;
		return {
			id: j.id as number,
			name: j.name as string,
			stage: j.stage as string,
			ref: j.ref as string,
			project: proj?.name ?? proj?.path_with_namespace ?? "",
			startedAt: (j.started_at as string | null) ?? undefined,
			webUrl: j.web_url as string,
		};
	});
}

/** Statuses for which the pipeline is still in progress (and can be canceled). */
export function isActive(status: PipelineStatus): boolean {
	return ["created", "waiting_for_resource", "preparing", "pending", "running", "canceling"].includes(status);
}

/** Statuses for which retrying the pipeline makes sense. */
export function isRetryable(status: PipelineStatus): boolean {
	return status === "failed" || status === "canceled";
}
