import streamDeck from "@elgato/streamdeck";

/** Plugin-wide settings shared by every key. */
export type GlobalSettings = {
	gitlabUrl?: string;
	token?: string;
};

let cached: Promise<GlobalSettings> | undefined;

export function loadGlobalSettings(): Promise<GlobalSettings> {
	cached ??= streamDeck.settings.getGlobalSettings<GlobalSettings>().catch((err) => {
		cached = undefined;
		throw err;
	});
	return cached;
}

/** Invalidates the cache and notifies `listener` whenever the property inspector changes global settings. */
export function watchGlobalSettings(listener: () => void): void {
	streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
		cached = Promise.resolve(ev.settings);
		listener();
	});
}
