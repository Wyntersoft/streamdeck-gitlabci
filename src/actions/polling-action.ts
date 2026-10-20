import streamDeck, {
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { type ConnectionSettings } from "../connection";
import { GitLabError } from "../gitlab";
import { type KeyView, renderDial, renderKey } from "../render";

export type PollSettings = JsonObject & ConnectionSettings & { label?: string; pollSeconds?: number };

export type Watch<TSettings extends PollSettings, TData> = {
	action: KeyAction<TSettings> | DialAction<TSettings>;
	settings: TSettings;
	/** Result of the last successful poll. */
	data?: TData;
	view?: KeyView;
	/** Where a dial is in the list it turns through, e.g. "2/5". */
	position?: string;
	pollTimer?: NodeJS.Timeout;
	animTimer?: NodeJS.Timeout;
	holdTimer?: NodeJS.Timeout;
	frame: number;
	/** Incremented on every refresh so results of superseded polls are dropped. */
	generation: number;
};

export type PollResult<TData> = {
	view: KeyView;
	data?: TData;
	position?: string;
	/** Poll again sooner than the configured interval, e.g. while something is in progress. */
	fast?: boolean;
	/** Poll again after exactly this many seconds, overriding the interval and `fast`. */
	delaySeconds?: number;
	/** Re-render the view a few times a second with an increasing `frame`. */
	animate?: boolean;
};

const DEFAULT_POLL_SECONDS = 60;
const FAST_POLL_SECONDS = 10;
const ANIMATION_MS = 250;
const LONG_PRESS_MS = 600;
/** Wait for the dial to settle before polling, so spinning through a list doesn't fire a request per tick. */
const ROTATE_SETTLE_MS = 400;
/** Wait for typing in the property inspector to pause before polling. */
const SETTINGS_SETTLE_MS = 700;

/**
 * Base for key and dial actions that periodically poll GitLab and render the result. Handles appearance, settings
 * changes, polling timers, animation, tap vs. hold, and dial rotation; subclasses implement {@link poll} and
 * optionally {@link tap}, {@link hold} and {@link rotate}.
 */
export abstract class PollingAction<TSettings extends PollSettings, TData> extends SingletonAction<TSettings> {
	protected readonly watches = new Map<string, Watch<TSettings, TData>>();

	/** Fetches the current state. Errors are rendered as an error view. */
	protected abstract poll(watch: Watch<TSettings, TData>): Promise<PollResult<TData>>;

	/** Label shown on loading and error views. */
	protected abstract label(watch: Watch<TSettings, TData>): string;

	/** Short press of a key or dial, or a tap on the touch strip. */
	protected tap?(watch: Watch<TSettings, TData>): Promise<void>;

	/** Long press of a key or dial, or a long touch on the touch strip. */
	protected hold?(watch: Watch<TSettings, TData>): Promise<void>;

	/** Dial rotation; update and persist `watch.settings`, then return true to re-poll once the dial settles. */
	protected rotate?(watch: Watch<TSettings, TData>, ticks: number): Promise<boolean>;

	override onWillAppear(ev: WillAppearEvent<TSettings>): void {
		if (!ev.action.isKey() && !ev.action.isDial()) return;
		const watch: Watch<TSettings, TData> = { action: ev.action, settings: ev.payload.settings, frame: 0, generation: 0 };
		this.watches.set(ev.action.id, watch);
		void this.refresh(watch);
	}

	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		const watch = this.watches.get(ev.action.id);
		if (!watch) return;
		this.#stop(watch);
		clearTimeout(watch.holdTimer);
		watch.generation++;
		this.watches.delete(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TSettings>): void {
		const watch = this.watches.get(ev.action.id);
		if (!watch) return;
		watch.settings = ev.payload.settings;
		watch.data = undefined;
		this.#stop(watch);
		watch.generation++;
		watch.pollTimer = setTimeout(() => void this.refresh(watch), SETTINGS_SETTLE_MS);
	}

	override onKeyDown(ev: KeyDownEvent<TSettings>): void {
		this.#pressStart(ev.action.id);
	}

	override onKeyUp(ev: KeyUpEvent<TSettings>): void {
		this.#pressEnd(ev.action.id);
	}

	override onDialDown(ev: DialDownEvent<TSettings>): void {
		this.#pressStart(ev.action.id);
	}

	override onDialUp(ev: DialUpEvent<TSettings>): void {
		this.#pressEnd(ev.action.id);
	}

	override onTouchTap(ev: TouchTapEvent<TSettings>): void {
		const watch = this.watches.get(ev.action.id);
		if (watch) void (ev.payload.hold ? this.hold : this.tap)?.call(this, watch);
	}

	override async onDialRotate(ev: DialRotateEvent<TSettings>): Promise<void> {
		const watch = this.watches.get(ev.action.id);
		if (!watch || !this.rotate || !(await this.rotate(watch, ev.payload.ticks))) return;

		// Show the new selection straight away; the poll follows once the dial stops moving.
		this.#stop(watch);
		watch.generation++;
		watch.data = undefined;
		await this.show(watch, { kind: "loading", label: this.label(watch) });
		watch.pollTimer = setTimeout(() => void this.refresh(watch), ROTATE_SETTLE_MS);
	}

	/** Re-polls every visible action, e.g. after the global token or URL changed. */
	refreshAll(): void {
		for (const watch of this.watches.values()) {
			watch.data = undefined;
			void this.refresh(watch);
		}
	}

	/** Redraws every visible action from fresh data without a loading flash, e.g. when a shared snapshot changes. */
	resync(): void {
		for (const watch of this.watches.values()) void this.refresh(watch);
	}

	protected async refresh(watch: Watch<TSettings, TData>): Promise<void> {
		this.#stop(watch);
		const generation = ++watch.generation;
		if (!watch.data) await this.show(watch, { kind: "loading", label: this.label(watch) });

		let result: PollResult<TData>;
		try {
			result = await this.poll(watch);
		} catch (err) {
			streamDeck.logger.warn(`${this.manifestId}: poll failed: ${(err as Error).message}`);
			result = { view: { kind: "error", label: this.label(watch), message: errorLabel(err) }, position: watch.position };
		}
		if (generation !== watch.generation) return;

		watch.data = result.data;
		watch.position = result.position;
		await this.show(watch, result.view);
		// Another refresh may have started while the image was being sent.
		if (generation !== watch.generation) return;

		let delay = Math.max(10, Number(watch.settings.pollSeconds) || DEFAULT_POLL_SECONDS);
		if (result.fast) delay = Math.min(delay, FAST_POLL_SECONDS);
		if (result.delaySeconds !== undefined) delay = result.delaySeconds;
		watch.pollTimer = setTimeout(() => void this.refresh(watch), delay * 1000);
		if (result.animate) {
			watch.animTimer = setInterval(() => {
				const view = watch.view;
				if (view?.kind === "pipeline" || view?.kind === "working") void this.show(watch, { ...view, frame: ++watch.frame });
			}, ANIMATION_MS);
		}
	}

	protected async show(watch: Watch<TSettings, TData>, view: KeyView): Promise<void> {
		watch.view = view;
		if (watch.action.isDial()) await watch.action.setFeedback({ canvas: renderDial(view, new Date(), watch.position) });
		else await watch.action.setImage(renderKey(view));
	}

	/** Persists settings changed by the plugin (e.g. by rotating a dial). */
	protected async saveSettings(watch: Watch<TSettings, TData>): Promise<void> {
		await watch.action.setSettings(watch.settings);
	}

	#pressStart(id: string): void {
		const watch = this.watches.get(id);
		if (!watch) return;
		clearTimeout(watch.holdTimer);
		watch.holdTimer = setTimeout(() => {
			watch.holdTimer = undefined;
			void this.hold?.(watch);
		}, LONG_PRESS_MS);
	}

	#pressEnd(id: string): void {
		const watch = this.watches.get(id);
		// No pending timer means the long press already fired.
		if (!watch?.holdTimer) return;
		clearTimeout(watch.holdTimer);
		watch.holdTimer = undefined;
		void this.tap?.(watch);
	}

	#stop(watch: Watch<TSettings, TData>): void {
		clearTimeout(watch.pollTimer);
		clearInterval(watch.animTimer);
		watch.pollTimer = watch.animTimer = undefined;
	}
}

export function errorLabel(err: unknown): string {
	if (err instanceof GitLabError) {
		switch (err.kind) {
			case "auth":
				return "Auth failed";
			case "scope":
				return "Needs api scope";
			case "forbidden":
				return "No CI access";
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
