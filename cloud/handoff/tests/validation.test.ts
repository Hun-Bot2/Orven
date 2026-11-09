import assert from "node:assert/strict";
import { test } from "vitest";
import { validateHandoffRequest } from "../src/domain/validation.ts";
import { calculateHashes } from "../src/domain/hashing.ts";
import { canTransition, isTerminal } from "../src/domain/state.ts";
import { HandoffStatus } from "../src/types/handoff.ts";
import { insertHandoff } from "../src/db/handoff.ts";

const request = {
  target_id: "synthetic-target",
  title: "Study note",
  content_markdown: "abc",
  idempotency_key: "123e4567-e89b-42d3-a456-426614174000",
};

test("validation preserves original content and rejects invalid input", () => {
  assert.deepEqual(validateHandoffRequest(request), request);
  for (const input of [null, {}, { ...request, extra: true },
    { ...request, title: " \n " }, { ...request, content_markdown: "" },
    { ...request, idempotency_key: "invalid" }]) {
    assert.throws(() => validateHandoffRequest(input), /Invalid handoff request/);
  }
  const original = { ...request, content_markdown: "  한글\n" };
  assert.equal(validateHandoffRequest(original).content_markdown, original.content_markdown);
});

test("hashes match SHA-256 and bind every payload field except retry key", async () => {
  const hashes = await calculateHashes(request);
  assert.equal(hashes.content_hash,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.deepEqual(await calculateHashes({ ...request, idempotency_key: "another-key" }), hashes);
  for (const field of ["target_id", "title", "content_markdown"] as const) {
    const changed = await calculateHashes({ ...request, [field]: request[field] + "!" });
    assert.notEqual(changed.payload_hash, hashes.payload_hash);
  }
});

test("state machine permits only the intended transitions", () => {
  const expected = {
    queued: ["claimed", "rejected", "expired"],
    claimed: ["queued", "awaiting_local_approval", "expired"],
    awaiting_local_approval: ["written", "rejected", "expired"],
    written: [], rejected: [], expired: [],
  };
  for (const from of Object.values(HandoffStatus)) {
    assert.equal(isTerminal(from), ["written", "rejected", "expired"].includes(from));
    for (const to of Object.values(HandoffStatus)) {
      assert.equal(canTransition(from, to), (expected[from] as string[]).includes(to));
    }
  }
});

test("insert distinguishes creation, replay, conflict and missing-row failure", async () => {
  const hashes = await calculateHashes(request);
  async function run(rows: unknown[]) {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return { bind(...values: unknown[]) {
          calls.push({ sql, values });
          return { async first() { return rows.shift(); } };
        } };
      },
    } as unknown as Parameters<typeof insertHandoff>[0];
    const result = await insertHandoff(db, "synthetic-user", request, hashes);
    assert.deepEqual(calls[0].values.slice(1, 8), ["synthetic-user", request.target_id,
      request.idempotency_key, hashes.payload_hash, hashes.content_hash, request.title,
      request.content_markdown]);
    const values = calls[0].values as (string | number)[];
    assert.equal(values[8], values[9]);
    assert.equal(Number(values[10]) - Number(values[8]), 86_400_000);
    if (calls.length === 2) {
      assert.deepEqual(calls[1].values, ["synthetic-user", request.target_id, request.idempotency_key]);
    }
    return result;
  }
  assert.deepEqual(await run([{ handoff_id: "new" }]), { kind: "created", handoff_id: "new" });
  assert.deepEqual(await run([null, { handoff_id: "old", payload_hash: hashes.payload_hash }]),
    { kind: "replayed", handoff_id: "old" });
  assert.deepEqual(await run([null, { handoff_id: "old", payload_hash: "different" }]), { kind: "conflict" });
  await assert.rejects(run([null, null]), /no existing handoff/);
});
