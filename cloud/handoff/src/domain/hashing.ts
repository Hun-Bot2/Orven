import type {
  HandoffRequest,
  HandoffHashes
} from "../types/handoff.ts";

async function sha256Hex(
  input: string
): Promise<string> {
  // TODO 1:
  // TextEncoder를 이용해 UTF-8로 인코딩
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // TODO 2:
  // crypto.subtle.digest() 호출
  const hash = await crypto.subtle.digest("SHA-256", data);

  // TODO 3:
  // ArrayBuffer → Uint8Array 변환
  const hashArray = new Uint8Array(hash);

  // TODO 4:
  // 각 byte를 두 자리 hex로 변환
  const hashHex = Array.from(hashArray).map(byte => byte.toString(16).padStart(2, "0")).join("");

  // TODO 5:
  // 하나의 문자열로 합쳐 반환
  return hashHex;
}

export async function calculateHashes(
  request: HandoffRequest
): Promise<HandoffHashes> {

  // TODO 6:
  // content_markdown 원본의 SHA-256 계산
  const contentHash = await sha256Hex(request.content_markdown);
  // TODO 7:
  // 해시에 포함할 필드를 고정된 순서로 직렬화
  // target_id, title, content_markdown 등
  const payloadString = JSON.stringify({
    target_id: request.target_id,
    title: request.title,
    content_markdown: request.content_markdown,
  });

  // TODO 8:
  // payload_hash 계산
  const payloadHash = await sha256Hex(payloadString);

  // TODO 9:
  // 두 해시 반환
  return {
    content_hash: contentHash,
    payload_hash: payloadHash
  };
}
