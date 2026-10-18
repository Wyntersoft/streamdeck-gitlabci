import type { Connection } from "./gitlab";
import { normalizeBaseUrl } from "./gitlab";
import { loadGlobalSettings } from "./global-settings";

/** Per-key overrides of the account-wide GitLab URL and token. */
export type ConnectionSettings = {
	gitlabUrl?: string;
	token?: string;
};

/**
 * Resolves the GitLab instance and token for a key: per-key override, then `fallbackUrl` (e.g. from a pasted
 * project URL), then the global settings.
 */
export async function resolveConnection(settings: ConnectionSettings, fallbackUrl?: string): Promise<Connection> {
	const global = await loadGlobalSettings();
	return {
		baseUrl: normalizeBaseUrl(settings.gitlabUrl?.trim() || fallbackUrl || global.gitlabUrl),
		token: settings.token?.trim() || global.token?.trim() || undefined,
	};
}
