import type {
  HandoffRequest,
  HandoffHashes
} from "../types/handoff.ts";

export type InsertResult =
  | { kind: "created"; handoff_id: string }
  | { kind: "replayed"; handoff_id: string }
  | { kind: "conflict" };

export async function insertHandoff(
  db: D1Database,
  userId: string,
  request: HandoffRequest,
  hashes: HandoffHashes
): Promise<InsertResult> {

  // TODO 1:
  // crypto.randomUUID()로 handoff_id 생성
  const handoff_id=crypto.randomUUID();

  // TODO 2:
  // Date.now()로 현재 시간 생성
  const current_time=Date.now();

  // TODO 3:
  // 24시간 뒤 expires_at 계산
  const expires_at=current_time+24*60*60*1000;

  // TODO 4:
  // INSERT ... ON CONFLICT DO NOTHING
  // RETURNING handoff_id
const sql = `
  INSERT INTO handoffs (
    handoff_id,
    user_id,
    target_id,
    idempotency_key,
    payload_hash,
    content_hash,
    title,
    content_markdown,
    status,
    created_at,
    updated_at,
    expires_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
  ON CONFLICT(user_id, target_id, idempotency_key)
  DO NOTHING
  RETURNING handoff_id
`;

  // TODO 5:
  // Prepared Statement의 ?에 bind() 적용
  
const statement = db.prepare(sql).bind(
  handoff_id,                 // 1
  userId,                     // 2
  request.target_id,          // 3
  request.idempotency_key,    // 4
  hashes.payload_hash,        // 5
  hashes.content_hash,        // 6
  request.title,              // 7
  request.content_markdown,   // 8
  current_time,               // 9
  current_time,               // 10
  expires_at                  // 11
);

  
  // TODO 6: INSERT 성공 여부 확인
  const inserted = await statement.first<{
    handoff_id: string;
  }>();

  if (inserted !== null) {
    return {
      kind: "created",
      handoff_id: inserted.handoff_id
    };
  }

  // TODO 7: 기존 Handoff 조회
  const existing = await db
    .prepare(`
      SELECT handoff_id, payload_hash
      FROM handoffs
      WHERE user_id = ?
        AND target_id = ?
        AND idempotency_key = ?
    `)
    .bind(
      userId,
      request.target_id,
      request.idempotency_key
    )
    .first<{
      handoff_id: string;
      payload_hash: string;
    }>();

  // INSERT되지 않았는데 기존 행도 없다면
  // 정상적인 중복 요청으로 취급할 수 없음
  if (existing === null) {
    throw new Error(
      "Handoff insert returned no row, but no existing handoff was found"
    );
  }

  // TODO 8~9: 기존 Payload와 비교
  if (existing.payload_hash === hashes.payload_hash) {
    return {
      kind: "replayed",
      handoff_id: existing.handoff_id
    };
  }

  return { kind: "conflict" };

}
