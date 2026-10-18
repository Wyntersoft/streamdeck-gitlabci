import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchLatestPipeline, GitLabError, normalizeBaseUrl, parseProject } from "../src/gitlab.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
	let seen: { url: string; init?: RequestInit } | undefined;
	const pipeline = await fetchLatestPipeline({ baseUrl: "https://gl.test", token: "tok", project: "g/p", ref: "main" }, async (url, init) => {
		seen = { url, init };
		return json(200, { id: 7, status: "running", ref: "main", sha: "abc", web_url: "https://gl.test/g/p/-/pipelines/7", started_at: "2026-01-01T00:00:00Z", finished_at: null });
	});
	assert.equal(seen?.url, "https://gl.test/api/v4/projects/g%2Fp/pipelines/latest?ref=main");
	assert.equal((seen?.init?.headers as Record<string, string>)["PRIVATE-TOKEN"], "tok");
	assert.equal(pipeline.status, "running");
	assert.equal(pipeline.webUrl, "https://gl.test/g/p/-/pipelines/7");
	assert.equal(pipeline.finishedAt, undefined);
});

test("fetchLatestPipeline omits ref and token when not given", async () => {
	await fetchLatestPipeline({ baseUrl: "https://gl.test", project: "5" }, async (url, init) => {
		assert.equal(url, "https://gl.test/api/v4/projects/5/pipelines/latest");
		assert.equal((init?.headers as Record<string, string>)["PRIVATE-TOKEN"], undefined);
		return json(200, { id: 1, status: "success", ref: "main", sha: "x", web_url: "u" });
	});
});

test("fetchLatestPipeline classifies errors", async () => {
	const kind = (status: number, message: string, error?: string) =>
		fetchLatestPipeline({ baseUrl: "https://gl.test", project: "p" }, async () => json(status, error ? { error } : { message })).then(
			() => assert.fail("expected rejection"),
			(err: GitLabError) => err.kind,
		);
	assert.equal(await kind(401, "401 Unauthorized"), "auth");
	assert.equal(await kind(403, "", "insufficient_scope"), "auth");
	assert.equal(await kind(403, "403 Forbidden"), "no-pipeline");
	assert.equal(await kind(404, "404 Project Not Found"), "not-found");
	assert.equal(await kind(404, "404 Not found"), "no-pipeline");
	assert.equal(await kind(500, "boom"), "http");

	const network = await fetchLatestPipeline({ baseUrl: "https://gl.test", project: "p" }, async () => {
		throw new TypeError("fetch failed");
	}).catch((err: GitLabError) => err.kind);
	assert.equal(network, "network");
});
