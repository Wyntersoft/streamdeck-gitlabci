/**
 * Shares one runner snapshot between every runner key and dial, so they all show the same moment instead of each
 * polling on its own schedule (which could show "1 building" on the summary next to idle runner keys).
 */
import { type Connection, fetchRunnerSnapshot, normalizeBaseUrl, type RunnerSnapshot } from "./gitlab.ts";

/** Snapshots younger than this are reused rather than fetched again. */
const FRESH_MS = 3000;

type Entry = {
	conn: Connection;
	snapshot?: RunnerSnapshot;
	fetchedAt: number;
	inflight?: Promise<RunnerSnapshot>;
};

export class RunnerHub {
	readonly #entries = new Map<string, Entry>();
	readonly #listeners = new Set<() => void>();
	readonly #fetch: (conn: Connection) => Promise<RunnerSnapshot>;
	readonly #now: () => number;
	#reloadTimer?: ReturnType<typeof setTimeout>;

	constructor(fetch: (conn: Connection) => Promise<RunnerSnapshot> = (conn) => fetchRunnerSnapshot(conn), now = () => Date.now()) {
		this.#fetch = fetch;
		this.#now = now;
	}

	/**
	 * The current snapshot for a GitLab connection: reused when fresh, otherwise fetched once however many keys ask.
	 * Every new snapshot notifies the {@link onUpdate} listeners so all keys redraw from it together.
	 */
	get(conn: Connection): Promise<RunnerSnapshot> {
		const key = `${normalizeBaseUrl(conn.baseUrl)}\n${conn.token ?? ""}`;
		let entry = this.#entries.get(key);
		if (!entry) this.#entries.set(key, (entry = { conn, fetchedAt: 0 }));
		if (entry.snapshot && this.#now() - entry.fetchedAt < FRESH_MS) return Promise.resolve(entry.snapshot);
		if (entry.inflight) return entry.inflight;

		const current = entry;
		current.inflight = this.#fetch(conn)
			.then((snapshot) => {
				current.snapshot = snapshot;
				current.fetchedAt = this.#now();
				// Notify after the caller has its result, so listeners don't interrupt the poll that asked.
				queueMicrotask(() => this.#listeners.forEach((listener) => listener()));
				return snapshot;
			})
			.finally(() => (current.inflight = undefined));
		return current.inflight;
	}

	/** Called whenever a new snapshot arrives. Returns a function that removes the listener. */
	onUpdate(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Fetches fresh snapshots after `delayMs`, e.g. once a retried pipeline's jobs have had time to start. */
	reloadSoon(delayMs: number): void {
		clearTimeout(this.#reloadTimer);
		this.#reloadTimer = setTimeout(() => {
			for (const entry of this.#entries.values()) {
				entry.fetchedAt = Number.NEGATIVE_INFINITY;
				this.get(entry.conn).catch(() => undefined);
			}
		}, delayMs);
	}
}

export const runnerHub = new RunnerHub();
