import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient, GitHubError, type Fetcher } from "../../src/github/api.ts";

const respond = (status: number, body: unknown = {}, headers: Record<string, string> = {}): Fetcher =>
  async () => new Response(JSON.stringify(body), { status, headers });

const noWait = async () => {};
const networkError = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });

test("a network failure becomes a readable error, not a stack trace, after two retries", async () => {
  let calls = 0;
  const offline: Fetcher = async () => {
    calls++;
    throw networkError();
  };
  await assert.rejects(createClient(undefined, offline, noWait).get("/x"), (e: unknown) => {
    assert.ok(e instanceof GitHubError);
    assert.match(e.message, /Could not reach GitHub \(UND_ERR_CONNECT_TIMEOUT\)/);
    return true;
  });
  assert.equal(calls, 3);
});

test("a brief network failure is retried and the request succeeds", async () => {
  let calls = 0;
  const flaky: Fetcher = async () => {
    calls++;
    if (calls === 1) throw networkError();
    return new Response('{"ok":true}', { status: 200 });
  };
  assert.deepEqual(await createClient(undefined, flaky, noWait).get("/x"), { ok: true });
  assert.equal(calls, 2);
});

test("an HTTP error is not retried", async () => {
  let calls = 0;
  const failing: Fetcher = async () => {
    calls++;
    return new Response("{}", { status: 500 });
  };
  await assert.rejects(createClient(undefined, failing, noWait).get("/x"), /answered 500/);
  assert.equal(calls, 1);
});

test("tryGet turns 404 and 403 into null", async () => {
  assert.equal(await createClient(undefined, respond(404)).tryGet("/x"), null);
  assert.equal(await createClient(undefined, respond(403)).tryGet("/x"), null);
});

test("an exhausted rate limit is an error even for tryGet, and suggests a token", async () => {
  const limited = respond(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000000" });
  await assert.rejects(createClient(undefined, limited).tryGet("/x"), /rate limit.*GITHUB_TOKEN/);
});

test("the token is sent as a bearer header and never in the URL", async () => {
  let seen: { url: string; auth?: string | undefined } = { url: "" };
  const spy: Fetcher = async (url, init) => {
    seen = { url, auth: init.headers.Authorization };
    return new Response("{}", { status: 200 });
  };
  await createClient("secret-token", spy).get("/repos/a/b");
  assert.equal(seen.auth, "Bearer secret-token");
  assert.ok(!seen.url.includes("secret-token"));
});
