// Works out which repository and pull request a command refers to, the way `gh` does:
// from the argument, from --repo, or from the git repository in the current directory.
import { execFileSync } from "node:child_process";
import { parsePullRef } from "../github/read.js";
export const realGit = (args) => {
    try {
        return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    }
    catch {
        return null;
    }
};
export function parseRepo(text) {
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(text.trim());
    return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}
/** github.com remotes in https, ssh and scp-like form. Other hosts return null. */
export function repoFromRemote(url) {
    const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
    return m?.[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}
export class TargetError extends Error {
}
export function resolveRepo(repoOption, git) {
    if (repoOption) {
        const r = parseRepo(repoOption);
        if (!r)
            throw new TargetError(`--repo must look like owner/repo, got "${repoOption}".`);
        return r;
    }
    const remote = git(["remote", "get-url", "origin"]);
    if (!remote) {
        throw new TargetError("Not inside a git repository with an 'origin' remote. Use --repo owner/repo.");
    }
    const r = repoFromRemote(remote);
    if (!r)
        throw new TargetError(`The 'origin' remote is not on github.com (${remote}). Use --repo owner/repo.`);
    return r;
}
/**
 *   owner/repo#12 or a URL  -> that pull request
 *   12 or #12               -> pull request 12 of --repo or of the current directory
 *   nothing                 -> the open pull request of the current branch
 */
export function resolvePullTarget(arg, repoOption, git) {
    if (arg) {
        const full = parsePullRef(arg);
        if (full)
            return { kind: "pull", ref: full };
        const n = /^#?(\d+)$/.exec(arg.trim());
        if (!n?.[1])
            throw new TargetError(`"${arg}" is not a pull request. Use a number, owner/repo#number or a URL.`);
        return { kind: "pull", ref: { ...resolveRepo(repoOption, git), number: Number(n[1]) } };
    }
    const repo = resolveRepo(repoOption, git);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch || branch === "HEAD") {
        throw new TargetError("Could not tell the current branch. Give a pull request number.");
    }
    return { kind: "branch", repo, branch };
}
