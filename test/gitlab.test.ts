import assert from "node:assert/strict";
import { test } from "node:test";

import {
	cancelPipeline,
	fetchLatestPipeline,
	fetchQueue,
	fetchRunnerFleet,
	fetchRunnerSnapshot,
	fetchRunnerJobs,
	type FetchFn,
	GitLabError,
	isRetryable,
	normalizeBaseUrl,
	parseProject,
	retryPipeline,
	sortRunners,
} from "../src/gitlab.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const conn = { baseUrl: "https://gl.test", token: "tok" };
const pipelineBody = { id: 7, status: "running", ref: "main", sha: "abc", web_url: "https://gl.test/g/p/-/pipelines/7", started_at: "2026-01-01T00:00:00Z", finished_at: null };

type Call = { method: string; url: string; init?: RequestInit };

/** Records requests and answers from a route table keyed by "METHOD path". */
function fake(routes: Record<string, () => Response>): FetchFn & { calls: Call[] } {
	const calls: Call[] = [];
	const fn = async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push({ method, url, init });
		const route = routes[`${method} ${url.replace("https://gl.test/api/", "")}`];
		return route ? route() : json(500, { message: `unexpected ${method} ${url}` });
	};
	return Object.assign(fn, { calls });
}

const header = (call: Call, name: string) => (call.init?.headers as Record<string, string>)[name];

test("normalizeBaseUrl", () => {
	assert.equal(normalizeBaseUrl(undefined), "https://gitlab.com");
	assert.equal(normalizeBaseUrl("gitlab.example.com/"), "https://gitlab.example.com");
	assert.equal(normalizeBaseUrl("https://git.example.com/api/v4"), "https://git.example.com");
});

test("parseProject accepts paths and URLs", () => {
	assert.deepEqual(parseProject("group/project"), { project: "group/project" });
	assert.deepEqual(parseProject("42"), { project: "42" });
	assert.deepEqual(parseProject("https://gitlab.example.com/wyntersoft/sub/proj/-/pipelines/12"), {
		project: "wyntersoft/sub/proj",
		baseUrl: "https://gitlab.example.com",
	});
	assert.deepEqual(parseProject("https://gitlab.com/a/b.git"), { project: "a/b", baseUrl: "https://gitlab.com" });
});

test("fetchLatestPipeline builds the request and maps the response", async () => {
	const f = fake({ "GET v4/projects/g%2Fp/pipelines/latest?ref=main": () => json(200, pipelineBody) });
	const pipeline = await fetchLatestPipeline(conn, "g/p", "main", f);
	assert.equal(header(f.calls[0], "PRIVATE-TOKEN"), "tok");
	assert.equal(pipeline.status, "running");
	assert.equal(pipeline.warnings, false);
	assert.equal(pipeline.finishedAt, undefined);
});

test("fetchLatestPipeline detects success with warnings", async () => {
	const f = fake({
		"GET v4/projects/5/pipelines/latest": () => json(200, { ...pipelineBody, status: "success", detailed_status: { group: "success-with-warnings" } }),
	});
	const pipeline = await fetchLatestPipeline({ baseUrl: "https://gl.test" }, "5", undefined, f);
	assert.equal(pipeline.warnings, true);
	assert.equal(header(f.calls[0], "PRIVATE-TOKEN"), undefined);
});

test("fetchLatestPipeline classifies errors", async () => {
	const kind = (status: number, body: object) =>
		fetchLatestPipeline(conn, "p", undefined, async () => json(status, body)).then(
			() => assert.fail("expected rejection"),
			(err: GitLabError) => err.kind,
		);
	assert.equal(await kind(401, { message: "401 Unauthorized" }), "auth");
	assert.equal(await kind(403, { error: "insufficient_scope" }), "scope");
	assert.equal(await kind(404, { message: "404 Project Not Found" }), "not-found");
	assert.equal(await kind(404, { message: "404 Not found" }), "no-pipeline");
	assert.equal(await kind(500, { message: "boom" }), "http");

	const network = await fetchLatestPipeline(conn, "p", undefined, async () => {
		throw new TypeError("fetch failed");
	}).catch((err: GitLabError) => err.kind);
	assert.equal(network, "network");
});

test("retry and cancel POST to the pipeline", async () => {
	const f = fake({
		"POST v4/projects/g%2Fp/pipelines/7/retry": () => json(201, { ...pipelineBody, status: "pending" }),
		"POST v4/projects/g%2Fp/pipelines/7/cancel": () => json(200, { ...pipelineBody, status: "canceled" }),
	});
	assert.equal((await retryPipeline(conn, "g/p", 7, f)).status, "pending");
	assert.equal((await cancelPipeline(conn, "g/p", 7, f)).status, "canceled");
	assert.deepEqual(
		f.calls.map((c) => c.method),
		["POST", "POST"],
	);
});

test("fetchRunnerJobs maps running jobs", async () => {
	const f = fake({
		"GET v4/runners/9/jobs?status=running&order_by=id&sort=desc": () =>
			json(200, [{ id: 1, name: "build", stage: "build", ref: "main", project: { name: "api" }, started_at: "2026-01-01T00:00:00Z", web_url: "u" }]),
	});
	assert.deepEqual(await fetchRunnerJobs(conn, "9", f), [
		{ id: 1, name: "build", stage: "build", ref: "main", project: "api", startedAt: "2026-01-01T00:00:00Z", webUrl: "u" },
	]);
});

test("fetchRunnerFleet counts runners and queue", async () => {
	const runners = [
		{ id: 1, description: "a", status: "online", paused: false, job_execution_status: "active", runner_type: "instance_type" },
		{ id: 2, description: "b", status: "online", paused: false, job_execution_status: "idle", runner_type: "instance_type" },
		{ id: 3, description: "c", status: "online", paused: true, job_execution_status: "idle", runner_type: "instance_type" },
		{ id: 4, description: "d", status: "offline", paused: false, job_execution_status: "idle", runner_type: "project_type" },
	];
	const admin = fake({
		"GET v4/runners/all?per_page=100": () => json(200, runners),
		"POST graphql": () => json(200, { data: { jobs: { count: 3 } } }),
	});
	assert.deepEqual(await fetchRunnerFleet(conn, admin), { total: 4, online: 2, busy: 1, queued: 3 });

	// Non-admins can't list all runners or count instance-wide jobs.
	const user = fake({
		"GET v4/runners/all?per_page=100": () => json(403, { message: "403 Forbidden" }),
		"GET v4/runners?per_page=100": () => json(200, runners.slice(0, 1)),
		"POST graphql": () => json(200, { data: { jobs: null }, errors: [{ message: "denied" }] }),
	});
	assert.deepEqual(await fetchRunnerFleet(conn, user), { total: 1, online: 1, busy: 1, queued: undefined });
});

test("sortRunners orders by name then ID", () => {
	const r = (id: number, name: string) => ({ id, name, status: "online", paused: false, busy: false, type: "instance_type" });
	assert.deepEqual(
		sortRunners([r(3, "b"), r(2, "a"), r(1, "b")]).map((x) => x.id),
		[2, 1, 3],
	);
});

test("isRetryable covers failed, canceled and passed with warnings", () => {
	const p = (status: string, warnings = false) => ({ id: 1, status, warnings, ref: "main", sha: "x", webUrl: "u" }) as Parameters<typeof isRetryable>[0];
	assert.equal(isRetryable(p("failed")), true);
	assert.equal(isRetryable(p("canceled")), true);
	assert.equal(isRetryable(p("success", true)), true);
	assert.equal(isRetryable(p("success")), false);
	assert.equal(isRetryable(p("running")), false);
});

test("fetchRunnerSnapshot reads everything from one GraphQL query", async () => {
	const f = fake({
		"POST graphql": () =>
			json(200, {
				data: {
					runners: {
						nodes: [
							{ id: "gid://gitlab/Ci::Runner/9", description: "zeta", status: "ONLINE", paused: false, jobExecutionStatus: "ACTIVE", runnerType: "INSTANCE_TYPE" },
							{ id: "gid://gitlab/Ci::Runner/8", description: "", status: "OFFLINE", paused: false, jobExecutionStatus: "IDLE", runnerType: "PROJECT_TYPE" },
						],
					},
					running: {
						nodes: [
							{
								id: "gid://gitlab/Ci::Build/5",
								name: "compile",
								refName: "main",
								startedAt: "2026-01-01T00:00:00Z",
								webPath: "/g/p/-/jobs/5",
								stage: { name: "build" },
								runner: { id: "gid://gitlab/Ci::Runner/9" },
								project: { name: "api" },
							},
						],
					},
					pending: { count: 2 },
				},
			}),
	});
	const snapshot = await fetchRunnerSnapshot(conn, f);
	assert.equal(f.calls.length, 1);
	assert.deepEqual(
		snapshot.runners.map((r) => [r.id, r.name, r.status, r.busy, r.type]),
		[
			[8, "Runner #8", "offline", false, "project_type"],
			[9, "zeta", "online", true, "instance_type"],
		],
	);
	assert.deepEqual(snapshot.jobs[9], [
		{ id: 5, name: "compile", stage: "build", ref: "main", project: "api", startedAt: "2026-01-01T00:00:00Z", webUrl: "https://gl.test/g/p/-/jobs/5" },
	]);
	assert.equal(snapshot.queued, 2);
});

test("fetchRunnerSnapshot falls back to REST for non-admin tokens", async () => {
	const f = fake({
		"POST graphql": () => json(200, { data: { runners: null, running: null, pending: null }, errors: [{ message: "denied" }] }),
		"GET v4/runners/all?per_page=100": () => json(403, { message: "403 Forbidden" }),
		"GET v4/runners?per_page=100": () =>
			json(200, [
				{ id: 1, description: "busy", status: "online", paused: false, job_execution_status: "active", runner_type: "project_type" },
				{ id: 2, description: "idle", status: "online", paused: false, job_execution_status: "idle", runner_type: "project_type" },
			]),
		"GET v4/runners/1/jobs?status=running&order_by=id&sort=desc": () =>
			json(200, [{ id: 3, name: "test", stage: "test", ref: "dev", project: { name: "web" }, started_at: null, web_url: "u" }]),
	});
	const snapshot = await fetchRunnerSnapshot(conn, f);
	assert.deepEqual(
		snapshot.runners.map((r) => r.id),
		[1, 2],
	);
	assert.equal(snapshot.jobs[1][0].project, "web");
	assert.equal(snapshot.jobs[2], undefined);
	assert.equal(snapshot.queued, undefined);
	// No per-runner request for the idle runner.
	assert.equal(f.calls.filter((c) => c.url.includes("/runners/2/jobs")).length, 0);
});

test("a 403 from pipelines/latest is resolved through the pipeline list", async () => {
	const forbidden = () => json(403, { message: "403 Forbidden" });
	// The ref has no pipeline.
	const none = fake({
		"GET v4/projects/p/pipelines/latest?ref=dev": forbidden,
		"GET v4/projects/p/pipelines?per_page=1&order_by=id&sort=desc&ref=dev": () => json(200, []),
	});
	assert.equal(await fetchLatestPipeline(conn, "p", "dev", none).catch((err: GitLabError) => err.kind), "no-pipeline");

	// The token can't see the project's CI.
	const denied = fake({
		"GET v4/projects/p/pipelines/latest": forbidden,
		"GET v4/projects/p": () => json(200, { default_branch: "main" }),
		"GET v4/projects/p/pipelines?per_page=1&order_by=id&sort=desc&ref=main": forbidden,
	});
	assert.equal(await fetchLatestPipeline(conn, "p", undefined, denied).catch((err: GitLabError) => err.kind), "forbidden");

	// The list works even though "latest" didn't.
	const listed = fake({
		"GET v4/projects/p/pipelines/latest": forbidden,
		"GET v4/projects/p": () => json(200, { default_branch: "main" }),
		"GET v4/projects/p/pipelines?per_page=1&order_by=id&sort=desc&ref=main": () => json(200, [{ id: 7 }]),
		"GET v4/projects/p/pipelines/7": () => json(200, pipelineBody),
	});
	assert.equal((await fetchLatestPipeline(conn, "p", undefined, listed)).id, 7);
});

test("fetchQueue counts pending jobs and the longest wait", async () => {
	const f = fake({
		"GET v4/projects/g%2Fp/pipelines/7/jobs?scope[]=pending&per_page=100": () => json(200, [{ queued_duration: 12.5 }, { queued_duration: 157.5 }, { queued_duration: null }]),
	});
	assert.deepEqual(await fetchQueue(conn, "g/p", 7, f), { count: 3, seconds: 157.5 });
	const empty = fake({ "GET v4/projects/g%2Fp/pipelines/7/jobs?scope[]=pending&per_page=100": () => json(200, []) });
	assert.deepEqual(await fetchQueue(conn, "g/p", 7, empty), { count: 0, seconds: 0 });
});
