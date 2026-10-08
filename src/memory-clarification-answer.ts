// SPDX-License-Identifier: MIT
const answerFields = new Set([
  "day", "question_id", "revision", "choice", "skipped", "elaboration",
]);

/** Validate the public answer contract without rewriting the caller's revision or intent. */
export function memoryClarificationAnswer(input: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(input).some((field) => !answerFields.has(field))) {
    throw new Error("Memory answers allow only day, question_id, revision, choice, skipped, and elaboration");
  }
  if (typeof input.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)
    || !Number.isFinite(Date.parse(input.day))
    || new Date(input.day).toISOString().slice(0, 10) !== input.day) {
    throw new Error("Memory answer day must be a valid YYYY-MM-DD date");
  }
  if (typeof input.question_id !== "string" || !/^mq_[a-f0-9]{32}$/.test(input.question_id)) {
    throw new Error("Memory answer question_id must be an mq_ identifier with 32 lowercase hexadecimal characters");
  }
  if (!Number.isInteger(input.revision) || Number(input.revision) < 0) {
    throw new Error("Memory answer revision must be a nonnegative integer");
  }
  if (typeof input.skipped !== "boolean"
    || (input.skipped ? input.choice !== null
      : !Number.isInteger(input.choice) || Number(input.choice) < 0 || Number(input.choice) > 2)) {
    throw new Error("Memory answers require choice 0, 1, or 2 with skipped=false, or choice=null with skipped=true");
  }
  if (input.elaboration !== undefined
    && (typeof input.elaboration !== "string" || input.elaboration.length > 2000
      || (input.elaboration !== "" && !input.elaboration.trim())
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(input.elaboration))) {
    throw new Error("Memory answer elaboration must be text of at most 2000 characters without invalid control characters");
  }
  // Membership, current question/revision, secret-content checks, and publication stay server-owned.
  return input;
}
