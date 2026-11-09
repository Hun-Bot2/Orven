import * as z from "zod/v4";

const NonBlankString = z.string().refine(
  value => value.trim().length > 0,
  { error: "Must not be blank" }
);

export const HandoffRequestSchema = z.strictObject({
  target_id: NonBlankString,
  title: NonBlankString,
  content_markdown: NonBlankString,

  // TODO 1:
  // idempotency_key는 UUID 형식이어야 함
  idempotency_key: z.string().uuid()
});

export type HandoffRequest =
  z.infer<typeof HandoffRequestSchema>;

export function validateHandoffRequest(
  input: unknown
): HandoffRequest {

  // TODO 2:
  // safeParse()로 입력 검증
  const inputValidationResult = HandoffRequestSchema.safeParse(input);

  // TODO 3:
  // 실패하면 오류 반환 또는 예외 발생
  if (!inputValidationResult.success) {
    // Keep rejected input and validation details out of logs.
    throw new Error("Invalid handoff request");
  }

  // TODO 4:
  // 성공하면 검증된 데이터 반환
  return inputValidationResult.data;
}
