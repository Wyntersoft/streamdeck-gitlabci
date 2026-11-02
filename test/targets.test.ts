import assert from "node:assert/strict";
import { test } from "node:test";

import { dialTargets, keyTarget, needsBranchList, parseTarget, step } from "../src/targets.ts";

test("parseTarget", () => {
	assert.deepEqual(parseTarget("g/p"), { project: "g/p", ref: undefined });
	assert.deepEqual(parseTarget("g/p@feature/x"), { project: "g/p", ref: "feature/x" });
	assert.deepEqual(parseTarget("g/p", "dev"), { project: "g/p", ref: "dev" });
	assert.deepEqual(parseTarget("https://gl.test/g/p/-/pipelines"), { project: "g/p", baseUrl: "https://gl.test", ref: undefined });
});

test("keys show the configured project and branch", () => {
	assert.equal(keyTarget({}), undefined);
	assert.deepEqual(keyTarget({ project: "g/p", ref: "dev", dialMode: "projects", dialList: "x/y" }), { project: "g/p", ref: "dev" });
});

test("branches mode turns through the listed branches", () => {
	const settings = { project: "g/p", ref: "ignored-on-dials", dialList: "main\ndev\n\n release " };
	assert.equal(needsBranchList(settings), false);
	assert.deepEqual(
		dialTargets(settings).map((t) => t.ref),
		["main", "dev", "release"],
	);
});

test("branches mode without a list uses all branches then each recent branch", () => {
	const settings = { project: "g/p" };
	assert.equal(needsBranchList(settings), true);
	assert.deepEqual(
		dialTargets(settings, ["feat-a", "feat-b"]).map((t) => t.ref),
		[undefined, "feat-a", "feat-b"],
	);
	assert.deepEqual(dialTargets({ dialList: "main" }), []);
});

test("projects mode turns through the listed projects", () => {
	const settings = { dialMode: "projects" as const, dialList: "g/q\nother/r@dev" };
	assert.equal(needsBranchList(settings), false);
	assert.deepEqual(dialTargets(settings), [
		{ project: "g/q", ref: undefined },
		{ project: "other/r", ref: "dev" },
	]);
	assert.deepEqual(dialTargets({ dialMode: "projects" }), []);
});

test("step wraps in both directions", () => {
	assert.equal(step(0, 1, 3), 1);
	assert.equal(step(2, 1, 3), 0);
	assert.equal(step(0, -1, 3), 2);
	assert.equal(step(1, -7, 3), 0);
	assert.equal(step(5, 0, 3), 2);
	assert.equal(step(4, 2, 0), 0);
});
