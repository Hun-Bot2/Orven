/* 
FUNCTION canTransition(from, to):
    allowedTransitions ← {
        queued: [claimed, rejected, expired],
        claimed: [queued, awaiting_local_approval, expired],
        awaiting_local_approval: [written, rejected, expired],
        written: [],
        rejected: [],
        expired: []
    }

    RETURN to IS IN allowedTransitions[from]
*/

import { HandoffStatus } from "../types/handoff.ts";

// TODO 1: 각 상태에서 이동할 수 있는 상태를 정의
// 힌트: Record<HandoffStatus, readonly HandoffStatus[]>
const allowedTransitions: Record<HandoffStatus, readonly HandoffStatus[]> = {
  [HandoffStatus.QUEUED]: [HandoffStatus.CLAIMED, HandoffStatus.REJECTED, HandoffStatus.EXPIRED],
  [HandoffStatus.CLAIMED]: [HandoffStatus.QUEUED, HandoffStatus.AWAITING_APPROVAL, HandoffStatus.EXPIRED],
  [HandoffStatus.AWAITING_APPROVAL]: [HandoffStatus.WRITTEN, HandoffStatus.REJECTED, HandoffStatus.EXPIRED],
  [HandoffStatus.WRITTEN]: [],
  [HandoffStatus.REJECTED]: [],
  [HandoffStatus.EXPIRED]: []
};

export function canTransition(
  from: HandoffStatus,
  to: HandoffStatus
): boolean {
  // TODO 2: from에서 허용된 상태 목록 조회
  const allowed = allowedTransitions[from];
  // TODO 3: to가 포함되는지 검사
  return allowed.includes(to);
}

export function isTerminal(
  status: HandoffStatus
): boolean {
  // TODO 4: 종료 상태인지 검사
  return allowedTransitions[status].length === 0;
}
