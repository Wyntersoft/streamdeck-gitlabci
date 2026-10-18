import assert from "node:assert/strict";
import { test } from "node:test";

import { needsBranchList, parseTarget, step, targets } from "../src/targets.ts";

test("parseTarget", () => {
	assert.deepEqual(parseTarget("g/p"), { project: "g/p", ref: undefined });
	assert.deepEqual(parseTarget("g/p@feature/x"), { project: "g/p", ref: "feature/x" });
	assert.deepEqual(parseTarget("g/p", "dev"), { project: "g/p", ref: "dev" });
	assert.deepEqual(parseTarget("https://gl.test/g/p/-/pipelines"), { project: "g/p", baseUrl: "https://gl.test", ref: undefined });
});

test("no project means no targets", () => {
	assert.deepEqual(targets({}), []);
});

test("branches mode uses the configured list, else recent branches", () => {
	const settings = { project: "g/p", ref: "main", dialBranches: "main\ndev\n\n release " };
	assert.deepEqual(
		targets(settings).map((t) => t.ref),
		["main", "dev", "release"],
	);
	assert.equal(needsBranchList(settings), false);

	const auto = { project: "g/p" };
	assert.equal(needsBranchList(auto), true);
	assert.deepEqual(
		targets(auto, ["feat-a", "feat-b"]).map((t) => t.ref),
		[undefined, "feat-a", "feat-b"],
	);
});

test("projects mode lists projects with optional refs", () => {
	const settings = { project: "g/p", dialMode: "projects" as const, dialProjects: "g/q\nother/r@dev" };
	assert.equal(needsBranchList(settings), false);
	assert.deepEqual(targets(settings), [
		{ project: "g/p", ref: undefined },
		{ project: "g/q", ref: undefined },
		{ project: "other/r", ref: "dev" },
	]);
});

test("step wraps in both directions", () => {
	assert.equal(step(0, 1, 3), 1);
	assert.equal(step(2, 1, 3), 0);
	assert.equal(step(0, -1, 3), 2);
	assert.equal(step(1, -7, 3), 0);
	assert.equal(step(5, 0, 3), 2);
	assert.equal(step(4, 2, 0), 0);
});
