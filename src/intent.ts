/**
 * Tracks a retry or cancel the user asked for until GitLab's pipeline status reflects it. Right after accepting a
 * cancel, GitLab still reports the pipeline as running for a few seconds (and a retried one as failed), so the key
 * keeps saying "Canceling…" / "Retrying…" instead of flashing back to the old state.
 */
import { isActive, isRetryable, type Pipeline } from "./gitlab.ts";

export type Intent = {
	kind: "retry" | "cancel";
	pipelineId: number;
	/** Give up waiting and show whatever GitLab reports after this time (ms since epoch). */
	expiresAt: number;
};

/** How long to keep showing "Retrying…" / "Canceling…" while waiting for GitLab to catch up. */
export const INTENT_TIMEOUT_MS = 30_000;

/** True once `pipeline` shows the effect of the intent, a newer pipeline has replaced it, or the wait timed out. */
export function intentDone(intent: Intent, pipeline: Pipeline, now: number): boolean {
	if (now >= intent.expiresAt || pipeline.id !== intent.pipelineId) return true;
	// "canceling" is still active: keep saying "Canceling…" until the jobs have actually stopped.
	return intent.kind === "cancel" ? !isActive(pipeline.status) : !isRetryable(pipeline);
}
