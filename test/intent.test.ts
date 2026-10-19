import assert from "node:assert/strict";
import { test } from "node:test";

import type { Pipeline } from "../src/gitlab.ts";
import { type Intent, intentDone } from "../src/intent.ts";

const pipeline = (status: Pipeline["status"], extra: Partial<Pipeline> = {}): Pipeline => ({ id: 7, status, warnings: false, ref: "main", sha: "x", webUrl: "u", ...extra });
const cancel: Intent = { kind: "cancel", pipelineId: 7, expiresAt: 1000 };
const retry: Intent = { kind: "retry", pipelineId: 7, expiresAt: 1000 };

test("cancel waits until the pipeline stops", () => {
	assert.equal(intentDone(cancel, pipeline("running"), 0), false);
	assert.equal(intentDone(cancel, pipeline("canceling"), 0), false);
	assert.equal(intentDone(cancel, pipeline("canceled"), 0), true);
	assert.equal(intentDone(cancel, pipeline("failed"), 0), true);
});

test("retry waits until the pipeline is no longer failed", () => {
	assert.equal(intentDone(retry, pipeline("failed"), 0), false);
	assert.equal(intentDone(retry, pipeline("success", { warnings: true }), 0), false);
	assert.equal(intentDone(retry, pipeline("pending"), 0), true);
	assert.equal(intentDone(retry, pipeline("running"), 0), true);
});

test("a newer pipeline or the timeout ends the wait", () => {
	assert.equal(intentDone(cancel, pipeline("running", { id: 8 }), 0), true);
	assert.equal(intentDone(retry, pipeline("failed"), 1000), true);
});
