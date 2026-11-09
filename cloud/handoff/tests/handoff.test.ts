import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { calculateHashes } from "../src/domain/hashing.ts";
import { insertHandoff } from "../src/db/handoff.ts";

const userId = "test-user";
const targetId = "test-target";

beforeEach(async () => {
  // Storage is shared within a test file: clear children before parents.
  await env.DB.prepare("DELETE FROM handoffs").run();
  await env.DB.prepare("DELETE FROM targets").run();
  await env.DB.prepare("DELETE FROM users").run();
  const now = Date.now();

  await env.DB.prepare(`
    INSERT INTO users (user_id, created_at)
    VALUES (?, ?)
  `)
    .bind(userId, now)
    .run();

  await env.DB.prepare(`
    INSERT INTO targets (
      target_id,
      user_id,
      alias,
      created_at
    )
    VALUES (?, ?, ?, ?)
  `)
    .bind(targetId, userId, "Test Target", now)
    .run();
});

describe("insertHandoff", () => {
  const makeRequest = () => ({
    target_id: targetId,
    title: "Study note",
    content_markdown: "# Synthetic notes",
    idempotency_key: crypto.randomUUID(),
  });

  it("replays the same request without creating a second row", async () => {
    const request = makeRequest();
    const hashes = await calculateHashes(request);
    const first = await insertHandoff(env.DB, userId, request, hashes);
    const second = await insertHandoff(env.DB, userId, request, hashes);

    expect(first.kind).toBe("created");
    if (first.kind !== "created") throw new Error("Expected created result");
    expect(second).toEqual({ kind: "replayed", handoff_id: first.handoff_id });
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM handoffs")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("rejects changed payloads using the same idempotency key", async () => {
    const request = makeRequest();
    const hashes = await calculateHashes(request);
    const first = await insertHandoff(env.DB, userId, request, hashes);
    if (first.kind !== "created") throw new Error("Expected created result");

    for (const field of ["title", "content_markdown"] as const) {
      const changed = { ...request, [field]: request[field] + " changed" };
      expect(await insertHandoff(env.DB, userId, changed, await calculateHashes(changed)))
        .toEqual({ kind: "conflict" });
    }
    const saved = await env.DB.prepare(
      "SELECT title, content_markdown FROM handoffs WHERE handoff_id = ?",
    ).bind(first.handoff_id).first();
    expect(saved).toEqual({ title: request.title, content_markdown: request.content_markdown });
  });

  it("denies inserting a handoff for another user's target", async () => {
    await env.DB.prepare("INSERT INTO users (user_id, created_at) VALUES (?, ?)")
      .bind("other-user", Date.now()).run();
    const request = makeRequest();
    await expect(insertHandoff(env.DB, "other-user", request, await calculateHashes(request)))
      .rejects.toThrow(/FOREIGN KEY constraint failed/);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM handoffs")
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("creates a new handoff", async () => {
    const request = {
      target_id: targetId,
      title: "First Research",
      content_markdown: "# MCP\n\nResearch notes",
      idempotency_key: crypto.randomUUID()
    };

    const hashes = await calculateHashes(request);

    const result = await insertHandoff(
      env.DB,
      userId,
      request,
      hashes
    );

    expect(result.kind).toBe("created");

    if (result.kind !== "created") {
      throw new Error("Expected created result");
    }

    const saved = await env.DB.prepare(`
      SELECT title, content_markdown, status
      FROM handoffs
      WHERE handoff_id = ?
    `)
      .bind(result.handoff_id)
      .first<{
        title: string;
        content_markdown: string;
        status: string;
      }>();

    expect(saved).not.toBeNull();
    expect(saved?.title).toBe(request.title);
    expect(saved?.content_markdown).toBe(request.content_markdown);
    expect(saved?.status).toBe("queued");
  });
});
