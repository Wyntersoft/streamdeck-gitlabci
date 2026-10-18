import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { fetchLatestPipeline, GitLabError, isActive, normalizeBaseUrl, parseProject, type Pipeline } from "../gitlab";
import { type GlobalSettings, loadGlobalSettings } from "../global-settings";
import { type KeyView, renderKey } from "../render";

/** Per-key settings, edited in the property inspector. */
export type PipelineSettings = {
	project?: string;
	ref?: string;
	label?: string;
	pollSeconds?: number;
	/** Overrides the global instance URL for this key. */
	gitlabUrl?: string;
	/** Overrides the global token for this key. */
	token?: string;
};

const DEFAULT_POLL_SECONDS = 60;
const ACTIVE_POLL_SECONDS = 10;
const ANIMATION_MS = 250;

type Watch = {
	action: KeyAction<PipelineSettings>;
	settings: PipelineSettings;
	pipeline?: Pipeline;
	view?: KeyView;
	pollTimer?: NodeJS.Timeout;
	animTimer?: NodeJS.Timeout;
	frame: number;
	generation: number;
};

/**
 * Shows the status of the latest pipeline for a GitLab project/ref; pressing the key opens it in the browser.
 */
@action({ UUID: "com.wyntersoft.gitlabci.pipeline" })
export class PipelineStatusAction extends SingletonAction<PipelineSettings> {
	readonly #watches = new Map<string, Watch>();

	override onWillAppear(ev: WillAppearEvent<PipelineSettings>): void {
		if (!ev.action.isKey()) return;
		const watch: Watch = { action: ev.action, settings: ev.payload.settings, frame: 0, generation: 0 };
		this.#watches.set(ev.action.id, watch);
		void this.#refresh(watch);
	}

	override onWillDisappear(ev: WillDisappearEvent<PipelineSettings>): void {
		const watch = this.#watches.get(ev.action.id);
		if (!watch) return;
		this.#stop(watch);
		watch.generation++;
		this.#watches.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PipelineSettings>): void {
		const watch = this.#watches.get(ev.action.id);
		if (!watch) return;
		watch.settings = ev.payload.settings;
		watch.pipeline = undefined;
		void this.#refresh(watch);
	}

	override async onKeyDown(ev: KeyDownEvent<PipelineSettings>): Promise<void> {
		const watch = this.#watches.get(ev.action.id);
		if (!watch) return;

		const target = await this.#target(watch.settings);
		if (watch.pipeline?.webUrl) {
			await streamDeck.system.openUrl(watch.pipeline.webUrl);
		} else if (target) {
			await streamDeck.system.openUrl(`${target.baseUrl}/${target.project}/-/pipelines`);
		} else {
			await ev.action.showAlert();
		}
		void this.#refresh(watch);
	}

	/** Re-polls every visible key, e.g. after the global token or URL changed. */
	refreshAll(): void {
		for (const watch of this.#watches.values()) {
			watch.pipeline = undefined;
			void this.#refresh(watch);
		}
	}

	async #target(settings: PipelineSettings): Promise<{ baseUrl: string; token?: string; project: string } | undefined> {
		if (!settings.project?.trim()) return undefined;
		const global: GlobalSettings = await loadGlobalSettings();
		const parsed = parseProject(settings.project);
		return {
			baseUrl: normalizeBaseUrl(settings.gitlabUrl?.trim() || parsed.baseUrl || global.gitlabUrl),
			token: settings.token?.trim() || global.token,
			project: parsed.project,
		};
	}

	async #refresh(watch: Watch): Promise<void> {
		this.#stop(watch);
		const generation = ++watch.generation;
		const target = await this.#target(watch.settings);
		if (!target) {
			await this.#show(watch, { kind: "setup" });
			return;
		}

		const label = watch.settings.label?.trim() || target.project.split("/").pop() || target.project;
		if (!watch.pipeline) await this.#show(watch, { kind: "loading", label });

		let delay = Math.max(10, Number(watch.settings.pollSeconds) || DEFAULT_POLL_SECONDS);
		try {
			watch.pipeline = await fetchLatestPipeline({ ...target, ref: watch.settings.ref });
			if (generation !== watch.generation) return;
			if (isActive(watch.pipeline.status)) delay = Math.min(delay, ACTIVE_POLL_SECONDS);
			await this.#show(watch, { kind: "pipeline", label, pipeline: watch.pipeline });
		} catch (err) {
			if (generation !== watch.generation) return;
			watch.pipeline = undefined;
			streamDeck.logger.warn(`Fetching pipeline for ${target.project} failed: ${(err as Error).message}`);
			await this.#show(watch, { kind: "error", label, message: errorLabel(err) });
		}

		// Another refresh may have started while the image was being sent.
		if (generation !== watch.generation) return;
		watch.pollTimer = setTimeout(() => void this.#refresh(watch), delay * 1000);
		if (watch.pipeline?.status === "running" || watch.pipeline?.status === "canceling") {
			watch.animTimer = setInterval(() => {
				if (watch.view?.kind !== "pipeline") return;
				void this.#show(watch, { ...watch.view, frame: ++watch.frame });
			}, ANIMATION_MS);
		}
	}

	async #show(watch: Watch, view: KeyView): Promise<void> {
		watch.view = view;
		await watch.action.setImage(renderKey(view));
	}

	#stop(watch: Watch): void {
		clearTimeout(watch.pollTimer);
		clearInterval(watch.animTimer);
		watch.pollTimer = watch.animTimer = undefined;
	}
}

function errorLabel(err: unknown): string {
	if (err instanceof GitLabError) {
		switch (err.kind) {
			case "auth":
				return "Auth failed";
			case "not-found":
				return "Not found";
			case "no-pipeline":
				return "No pipelines";
			case "network":
				return "Offline";
			case "http":
				return `HTTP ${err.status}`;
		}
	}
	return "Error";
}
