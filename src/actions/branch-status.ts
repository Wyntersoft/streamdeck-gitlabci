import streamDeck, { action } from "@elgato/streamdeck";

import { resolveConnection } from "../connection";
import { cancelPipeline, type Connection, fetchLatestPipeline, isActive, isRetryable, listBranches, type Pipeline, retryPipeline } from "../gitlab";
import { needsBranchList, step, type Target, type TargetSettings, targets } from "../targets";
import { errorLabel, type PollResult, type PollSettings, PollingAction, type Watch } from "./polling-action";

/** Per-action settings, edited in the property inspector. */
export type BranchSettings = PollSettings &
	TargetSettings & {
		/** Tap retries a failed or canceled pipeline. Enabled unless explicitly turned off. */
		allowRetry?: boolean;
		/** Long press cancels a running pipeline. Enabled unless explicitly turned off. */
		allowCancel?: boolean;
		/** Position of a dial in its list of targets. */
		dialIndex?: number;
	};

type BranchData = { conn: Connection; project: string; pipeline: Pipeline };

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
		// A custom label names the configured project/ref, not the other entries a dial turns to.
		const isPrimary = !watch.action.isDial() || (watch.settings.dialIndex ?? 0) === 0;
		return (isPrimary && watch.settings.label?.trim()) || target?.project.split("/").pop() || "GitLab CI";
	}

	protected override async poll(watch: Watch<BranchSettings, BranchData>): Promise<PollResult<BranchData>> {
		if (!watch.settings.project?.trim()) return { view: { kind: "setup", title: "Branch" } };

		const isDial = watch.action.isDial();
		const list = isDial ? targets(watch.settings, await this.#recentBranches(watch)) : targets(watch.settings).slice(0, 1);
		const index = isDial ? step(watch.settings.dialIndex ?? 0, 0, list.length) : 0;
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
		const length = targets(watch.settings, this.#branchLists.get(watch.action.id)?.names).length;
		if (length < 2) return false;
		watch.settings.dialIndex = step(watch.settings.dialIndex ?? 0, ticks, length);
		await this.saveSettings(watch);
		return true;
	}

	protected override async tap(watch: Watch<BranchSettings, BranchData>): Promise<void> {
		const data = watch.data;
		if (!data || watch.settings.allowRetry === false || !isRetryable(data.pipeline.status)) return;
		await this.#mutate(watch, "retry", () => retryPipeline(data.conn, data.project, data.pipeline.id));
	}

	protected override async hold(watch: Watch<BranchSettings, BranchData>): Promise<void> {
		const data = watch.data;
		if (!data || watch.settings.allowCancel === false || !isActive(data.pipeline.status)) return;
		await this.#mutate(watch, "cancel", () => cancelPipeline(data.conn, data.project, data.pipeline.id));
	}

	/** The target currently selected, without fetching anything. */
	#current(watch: Watch<BranchSettings, BranchData>): Target | undefined {
		if (!watch.action.isDial()) return targets(watch.settings)[0];
		const list = targets(watch.settings, this.#branchLists.get(watch.action.id)?.names);
		return list[step(watch.settings.dialIndex ?? 0, 0, list.length)];
	}

	async #recentBranches(watch: Watch<BranchSettings, BranchData>): Promise<string[]> {
		if (!needsBranchList(watch.settings)) return [];
		const cached = this.#branchLists.get(watch.action.id);
		if (cached && Date.now() - cached.fetchedAt < BRANCH_LIST_TTL_MS) return cached.names;

		const [primary] = targets(watch.settings);
		try {
			const conn = await resolveConnection(watch.settings, primary.baseUrl);
			const names = (await listBranches(conn, primary.project)).filter((b) => !b.isDefault && b.name !== primary.ref).map((b) => b.name);
			this.#branchLists.set(watch.action.id, { names, fetchedAt: Date.now() });
			return names;
		} catch (err) {
			// The dial still works on the configured branch; try the list again next poll.
			streamDeck.logger.warn(`Listing branches of ${primary.project} failed: ${(err as Error).message}`);
			return cached?.names ?? [];
		}
	}

	async #mutate(watch: Watch<BranchSettings, BranchData>, verb: string, run: () => Promise<Pipeline>): Promise<void> {
		try {
			await run();
			if (watch.action.isKey()) await watch.action.showOk();
		} catch (err) {
			streamDeck.logger.warn(`Pipeline ${verb} failed: ${(err as Error).message}`);
			await watch.action.showAlert();
			// A read-only token is the usual cause; say so until the next poll.
			const message = errorLabel(err) === "Auth failed" ? "Needs api scope" : errorLabel(err);
			await this.show(watch, { kind: "error", label: this.label(watch), message });
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}
		await this.refresh(watch);
	}
}
