// The only place that talks to GitHub. Read-only: every call is a GET.
export class GitHubError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
// Every request is a GET, so a network failure can be retried safely.
const RETRY_DELAYS_MS = [500, 2000];
export function createClient(token, fetcher = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
    const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "PRotocol",
    };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    async function send(path) {
        for (let attempt = 0;; attempt++) {
            try {
                return await fetcher(`https://api.github.com${path}`, { headers });
            }
            catch (err) {
                // fetch rejects on network failures (no connection, DNS, timeout).
                const delay = RETRY_DELAYS_MS[attempt];
                if (delay !== undefined) {
                    await sleep(delay);
                    continue;
                }
                const cause = err.cause?.code;
                throw new GitHubError(0, `Could not reach GitHub${cause ? ` (${cause})` : ""}. Check your connection and try again.`);
            }
        }
    }
    async function request(path, soft) {
        const res = await send(path);
        if (res.ok)
            return (await res.json());
        if (soft && (res.status === 403 || res.status === 404) && res.headers.get("x-ratelimit-remaining") !== "0") {
            return null;
        }
        if (res.headers.get("x-ratelimit-remaining") === "0") {
            const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
            const when = reset ? new Date(reset).toLocaleTimeString() : "later";
            throw new GitHubError(res.status, `GitHub rate limit reached; it resets at ${when}.${token ? "" : " Set GITHUB_TOKEN to get a higher limit."}`);
        }
        if (res.status === 404)
            throw new GitHubError(404, `Not found: ${path}. Check the name, or set GITHUB_TOKEN for private repositories.`);
        if (res.status === 401)
            throw new GitHubError(401, "GitHub rejected the token in GITHUB_TOKEN.");
        throw new GitHubError(res.status, `GitHub answered ${res.status} for ${path}.`);
    }
    return {
        get: async (path) => (await request(path, false)),
        tryGet: (path) => request(path, true),
    };
}
