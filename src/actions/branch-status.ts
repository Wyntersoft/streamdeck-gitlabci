import streamDeck, { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { cancelPipeline, type Connection, fetchLatestPipeline, isActive, isRetryable, parseProject, type Pipeline, retryPipeline } from "../gitlab";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

/** Per-key settings, edited in the property inspector. */
export type BranchSettings = PollSettings & {
	project?: string;
	ref?: string;
	/** Tap retries a failed or canceled pipeline. Enabled unless explicitly turned off. */
	allowRetry?: boolean;
	/** Long press cancels a running pipeline. Enabled unless explicitly turned off. */
	allowCancel?: boolean;
};

type BranchData = { conn: Connection; project: string; pipeline: Pipeline };

const LONG_PRESS_MS = 600;

/**
 * Shows the status of the latest pipeline for a project's branch. Tap retries a failed pipeline; long press cancels a
 * running one.
 */
@action({ UUID: "com.wyntersoft.gitlabci.branch" })
export class BranchStatusAction extends PollingAction<BranchSettings, BranchData> {
	readonly #holds = new Map<string, NodeJS.Timeout>();

	protected override label(settings: BranchSettings): string {
		const project = settings.project?.trim() ? parseProject(settings.project).project : "";
		return settings.label?.trim() || project.split("/").pop() || "GitLab CI";
	}

	protected override async poll(watch: Watch<BranchSettings, BranchData>): Promise<PollResult<BranchData>> {
		if (!watch.settings.project?.trim()) return { view: { kind: "setup", title: "Branch" } };

		const parsed = parseProject(watch.settings.project);
		const conn = await resolveConnection(watch.settings, parsed.baseUrl);
		const pipeline = await fetchLatestPipeline(conn, parsed.project, watch.settings.ref);
		const active = isActive(pipeline.status);
		return {
			view: { kind: "pipeline", label: this.label(watch.settings), pipeline },
			data: { conn, project: parsed.project, pipeline },
			fast: active,
			animate: pipeline.status === "running" || pipeline.status === "canceling",
		};
	}

	override onKeyDown(ev: KeyDownEvent<BranchSettings>): void {
		clearTimeout(this.#holds.get(ev.action.id));
		this.#holds.set(
			ev.action.id,
			setTimeout(() => {
				this.#holds.delete(ev.action.id);
				void this.#cancel(ev.action.id);
			}, LONG_PRESS_MS),
		);
	}

	override onKeyUp(ev: KeyUpEvent<BranchSettings>): void {
		const hold = this.#holds.get(ev.action.id);
		// No pending timer means the long press already fired.
		if (!hold) return;
		clearTimeout(hold);
		this.#holds.delete(ev.action.id);
		void this.#retry(ev.action.id);
	}

	async #retry(id: string): Promise<void> {
		const watch = this.watches.get(id);
		const data = watch?.data;
		if (!watch || !data || watch.settings.allowRetry === false || !isRetryable(data.pipeline.status)) return;
		await this.#mutate(watch, "retry", () => retryPipeline(data.conn, data.project, data.pipeline.id));
	}

	async #cancel(id: string): Promise<void> {
		const watch = this.watches.get(id);
		const data = watch?.data;
		if (!watch || !data || watch.settings.allowCancel === false || !isActive(data.pipeline.status)) return;
		await this.#mutate(watch, "cancel", () => cancelPipeline(data.conn, data.project, data.pipeline.id));
	}

	async #mutate(watch: Watch<BranchSettings, BranchData>, verb: string, run: () => Promise<Pipeline>): Promise<void> {
		try {
			await run();
			await watch.action.showOk();
		} catch (err) {
			streamDeck.logger.warn(`Pipeline ${verb} failed: ${(err as Error).message}`);
			await watch.action.showAlert();
			// A read-only token is the usual cause; say so on the key until the next poll.
			await this.show(watch, { kind: "error", label: this.label(watch.settings), message: errorLabel(err) === "Auth failed" ? "Needs api scope" : errorLabel(err) });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
		await this.refresh(watch);
	}
}
