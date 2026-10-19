import streamDeck, { action } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { cancelPipeline, type Connection, fetchLatestPipeline, isActive, isRetryable, listBranches, type Pipeline, retryPipeline } from "../gitlab";
import { runnerHub } from "../runner-hub";
import { dialTargets, keyTarget, needsBranchList, step, type Target, type TargetSettings } from "../targets";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

/** Per-action settings, edited in the property inspector. */
export type BranchSettings = PollSettings &
	TargetSettings & {
		/** Tap retries a failed, canceled or passed-with-warnings pipeline. Enabled unless explicitly turned off. */
		allowRetry?: boolean;
		/** Long press cancels a running pipeline. Enabled unless explicitly turned off. */
		allowCancel?: boolean;
		/** Position of a dial in its list of targets. */
		dialIndex?: number;
	};

type BranchData = { conn: Connection; project: string; pipeline: Pipeline };

/** How long "No failed jobs" and similar notices stay up. */
const NOTICE_MS = 1500;
/** Delay before runner keys refresh after a retry or cancel, giving jobs time to start or stop. */
const RUNNER_RELOAD_MS = 5000;

/** How long a dial's automatic branch list is reused before being fetched again. */
const BRANCH_LIST_TTL_MS = 5 * 60_000;

/**
 * Shows the status of the latest pipeline for a project's branch. Tap retries a failed pipeline; long press cancels a
 * running one. On a dial, rotating turns through branches of the project or through a list of projects.
 */
@action({ UUID: "com.wyntersoft.gitlabci.branch" })
export class BranchStatusAction extends PollingAction<BranchSettings, BranchData> {
	/** Recently updated branches per dial, for branches mode without a configured list. */
	readonly #branchLists = new Map<string, { names: string[]; fetchedAt: number }>();

	override onDidReceiveSettings(ev: Parameters<PollingAction<BranchSettings, BranchData>["onDidReceiveSettings"]>[0]): void {
		this.#branchLists.delete(ev.action.id);
		super.onDidReceiveSettings(ev);
	}

	protected override label(watch: Watch<BranchSettings, BranchData>, target = this.#current(watch)): string {
		// Dials turn through several targets, so they always show the project name.
		const custom = watch.action.isDial() ? undefined : watch.settings.label?.trim();
		return custom || target?.project.split("/").pop() || "GitLab CI";
	}

	protected override async poll(watch: Watch<BranchSettings, BranchData>): Promise<PollResult<BranchData>> {
		const isDial = watch.action.isDial();
		const single = keyTarget(watch.settings);
		const list = isDial ? dialTargets(watch.settings, await this.#recentBranches(watch)) : single ? [single] : [];
		if (list.length === 0) return { view: { kind: "setup", title: "Branch" } };

		const index = step(watch.settings.dialIndex ?? 0, 0, list.length);
		const target = list[index];
		const position = list.length > 1 ? `${index + 1}/${list.length}` : undefined;

		const conn = await resolveConnection(watch.settings, target.baseUrl);
		const pipeline = await fetchLatestPipeline(conn, target.project, target.ref);
		return {
			view: { kind: "pipeline", label: this.label(watch, target), pipeline },
			data: { conn, project: target.project, pipeline },
			position,
			fast: isActive(pipeline.status),
			animate: pipeline.status === "running" || pipeline.status === "canceling",
		};
	}

	protected override async rotate(watch: Watch<BranchSettings, BranchData>, ticks: number): Promise<boolean> {
		const length = dialTargets(watch.settings, this.#branchLists.get(watch.action.id)?.names).length;
		if (length < 2) return false;
		watch.settings.dialIndex = step(watch.settings.dialIndex ?? 0, ticks, length);
		await this.saveSettings(watch);
		return true;
	}

	protected override async tap(watch: Watch<BranchSettings, BranchData>): Promise<void> {
		const data = watch.data;
		if (!data) return;
		if (watch.settings.allowRetry === false) return this.#notice(watch, "Retry is off");
		if (!isRetryable(data.pipeline)) return this.#notice(watch, "No failed jobs");
		await this.#mutate(watch, "Retrying…", () => retryPipeline(data.conn, data.project, data.pipeline.id));
	}

	protected override async hold(watch: Watch<BranchSettings, BranchData>): Promise<void> {
		const data = watch.data;
		if (!data) return;
		if (watch.settings.allowCancel === false) return this.#notice(watch, "Cancel is off");
		if (!isActive(data.pipeline.status)) return this.#notice(watch, "Not running");
		await this.#mutate(watch, "Canceling…", () => cancelPipeline(data.conn, data.project, data.pipeline.id));
	}

	/** Briefly explains why a press did nothing, then puts the status back. */
	async #notice(watch: Watch<BranchSettings, BranchData>, message: string): Promise<void> {
		const previous = watch.view;
		const notice = { kind: "notice" as const, label: this.label(watch), message };
		await this.show(watch, notice);
		setTimeout(() => {
			// Leave it alone if a poll has redrawn the key meanwhile.
			if (watch.view === notice && previous) void this.show(watch, previous);
		}, NOTICE_MS);
	}

	/** The target currently selected, without fetching anything. */
	#current(watch: Watch<BranchSettings, BranchData>): Target | undefined {
		if (!watch.action.isDial()) return keyTarget(watch.settings);
		const list = dialTargets(watch.settings, this.#branchLists.get(watch.action.id)?.names);
		return list[step(watch.settings.dialIndex ?? 0, 0, list.length)];
	}

	async #recentBranches(watch: Watch<BranchSettings, BranchData>): Promise<string[]> {
		if (!needsBranchList(watch.settings)) return [];
		const cached = this.#branchLists.get(watch.action.id);
		if (cached && Date.now() - cached.fetchedAt < BRANCH_LIST_TTL_MS) return cached.names;

		const [primary] = dialTargets(watch.settings);
		try {
			const conn = await resolveConnection(watch.settings, primary.baseUrl);
			const names = (await listBranches(conn, primary.project)).filter((b) => !b.isDefault).map((b) => b.name);
			this.#branchLists.set(watch.action.id, { names, fetchedAt: Date.now() });
			return names;
		} catch (err) {
			// The dial still works on the configured branch; try the list again next poll.
			streamDeck.logger.warn(`Listing branches of ${primary.project} failed: ${(err as Error).message}`);
			return cached?.names ?? [];
		}
	}

	async #mutate(watch: Watch<BranchSettings, BranchData>, message: string, run: () => Promise<Pipeline>): Promise<void> {
		// Answer the press straight away; the request can take a moment.
		const label = this.label(watch);
		let frame = 0;
		await this.show(watch, { kind: "working", label, message, frame });
		const spin = setInterval(() => void this.show(watch, { kind: "working", label, message, frame: ++frame }), 250);
		try {
			await run();
			clearInterval(spin);
			if (watch.action.isKey()) await watch.action.showOk();
			// The retried or canceled jobs reach the runners a few seconds later.
			runnerHub.reloadSoon(RUNNER_RELOAD_MS);
		} catch (err) {
			clearInterval(spin);
			streamDeck.logger.warn(`${message} failed: ${(err as Error).message}`);
			await watch.action.showAlert();
			await this.show(watch, { kind: "error", label: this.label(watch), message: errorLabel(err) });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
		await this.refresh(watch);
	}
}
