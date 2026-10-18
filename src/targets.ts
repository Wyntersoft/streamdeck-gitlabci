/**
 * Works out which project/ref a branch key or dial shows. Dials can turn through a list of branches of one project or
 * a list of projects.
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
	/** One branch per line; blank means the project's recently updated branches. */
	dialBranches?: string;
	/** One `group/project` or `group/project@branch` per line. */
	dialProjects?: string;
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

/** True when the dial needs the project's branch list from GitLab. */
export function needsBranchList(settings: TargetSettings): boolean {
	return (settings.dialMode ?? "branches") === "branches" && lines(settings.dialBranches).length === 0;
}

/**
 * Every target the dial turns through, the configured project/ref first. `recentBranches` (non-default branches,
 * newest first) is used in branches mode when no list is configured.
 */
export function targets(settings: TargetSettings, recentBranches: string[] = []): Target[] {
	if (!settings.project?.trim()) return [];
	const primary = parseTarget(settings.project, settings.ref);

	if (settings.dialMode === "projects") return [primary, ...lines(settings.dialProjects).map((entry) => parseTarget(entry))];

	const refs = lines(settings.dialBranches);
	const others = (refs.length ? refs : recentBranches).filter((ref) => ref !== primary.ref);
	return [primary, ...others.map((ref) => ({ ...primary, ref }))];
}

/** Steps `index` by `ticks` through a list of `length` items, wrapping at both ends. */
export function step(index: number, ticks: number, length: number): number {
	return length > 0 ? (((index + ticks) % length) + length) % length : 0;
}
