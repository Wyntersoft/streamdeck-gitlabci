/**
 * Works out which project/ref a branch key or dial shows. A key shows one project/ref; a dial turns through either the
 * branches of one project or a list of projects.
 */
import { parseProject } from "./gitlab.ts";

export type Target = {
	project: string;
	/** Undefined means the project's default branch. */
	ref?: string;
	/** Instance URL taken from a pasted project URL. */
	baseUrl?: string;
};

export type DialMode = "branches" | "projects";

export type TargetSettings = {
	project?: string;
	ref?: string;
	dialMode?: DialMode;
	/**
	 * What a dial turns through, one per line: branch names in branches mode (blank means the project's recently
	 * updated branches), `group/project` or `group/project@branch` in projects mode.
	 */
	dialList?: string;
};

const lines = (value: string | undefined) =>
	(value ?? "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

/** Parses `group/project`, `group/project@ref` or a project URL. Project paths can't contain "@", so split on the first. */
export function parseTarget(entry: string, ref?: string): Target {
	const at = /^https?:\/\//i.test(entry) ? -1 : entry.indexOf("@");
	const parsed = parseProject(at >= 0 ? entry.slice(0, at) : entry);
	const entryRef = at >= 0 ? entry.slice(at + 1).trim() : ref?.trim();
	return { ...parsed, ref: entryRef || undefined };
}

/** What a key shows. */
export function keyTarget(settings: TargetSettings): Target | undefined {
	return settings.project?.trim() ? parseTarget(settings.project, settings.ref) : undefined;
}

/** True when a dial needs the project's branch list from GitLab. */
export function needsBranchList(settings: TargetSettings): boolean {
	return settings.dialMode !== "projects" && !!settings.project?.trim() && lines(settings.dialList).length === 0;
}

/**
 * Everything a dial turns through. In branches mode without a configured list, that's the default branch followed by
 * `recentBranches` (non-default branches, newest first).
 */
export function dialTargets(settings: TargetSettings, recentBranches: string[] = []): Target[] {
	const list = lines(settings.dialList);
	if (settings.dialMode === "projects") {
		if (list.length) return list.map((entry) => parseTarget(entry));
		const single = keyTarget(settings);
		return single ? [single] : [];
	}

	if (!settings.project?.trim()) return [];
	const project = parseTarget(settings.project);
	const refs: (string | undefined)[] = list.length ? list : [undefined, ...recentBranches];
	return refs.map((ref) => ({ ...project, ref }));
}

/** Steps `index` by `ticks` through a list of `length` items, wrapping at both ends. */
export function step(index: number, ticks: number, length: number): number {
	return length > 0 ? (((index + ticks) % length) + length) % length : 0;
}
