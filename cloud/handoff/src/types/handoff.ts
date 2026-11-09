export const HandoffStatus = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  AWAITING_APPROVAL: "awaiting_local_approval",
  WRITTEN: "written",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;

export type HandoffStatus =
  (typeof HandoffStatus)[keyof typeof HandoffStatus];


export interface HandoffRequest {
  target_id: string;
  title:string;
  content_markdown: string;
  idempotency_key: string;
}

export interface HandoffHashes{
  content_hash:string;
  payload_hash:string;
}