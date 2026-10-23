import type { AnchorMeta, PersonalNote, PersonalReview, ReviewDraft } from "./review-types";

export type DraftState = { notes: PersonalNote[]; reviews: Record<string, ReviewDraft> };
export type ImportTarget = { paperId: string; questionId: string; atomIds: string[]; contentHash: string };
export type TargetRequest = { paperId: string; questionId: string; atomId?: string };
export type TargetResolver = (target: TargetRequest) => Promise<ImportTarget | undefined>;
export type ImportSummary = { notesAdded: number; reviewsAdded: number; duplicatesSkipped: number; copiesPreserved: number; changedQuestions: number };
export type RecordExport = { personalNotes: PersonalNote[]; unsavedNoteDrafts: PersonalNote[]; personalReviews: PersonalReview[]; unsavedReviewDrafts: ReviewDraft[] };
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 20_000;
const noteColors = new Set(["yellow", "green", "pink", "blue"]);
const statuses = new Set(["clear", "error", "unreviewed"]);
const anchorSections = new Set(["question", "explanation", "atom", "atom-statement", "atom-explanation"]);
export const reviewKey = (row: TargetRequest) => `${row.paperId}::${row.questionId}${row.atomId ? `::atom:${row.atomId}` : ""}`;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${label} 형식이 올바르지 않습니다.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, optional = false): string | undefined {
  if (optional && value == null) return undefined;
  if (typeof value !== "string" || value.length > max || (!optional && !value.length)) throw Error(`${label} 형식이나 길이를 확인해 주세요.`);
  return value;
}
function identifier(value: unknown, label: string, optional = false): string | undefined {
  const result = text(value, label, 250, optional);
  if (result === undefined || (optional && result === "")) return undefined;
  if (!result?.trim() || /[\u0000-\u0020\u007f]/.test(result) || result.includes("::")) throw Error(`${label} 식별자가 올바르지 않습니다.`);
  return result;
}
function revision(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw Error(`${label} 버전이 올바르지 않습니다.`);
  return value as number;
}
function timestamp(value: unknown, label: string): string | undefined {
  const result = text(value, label, 80, true);
  if (result !== undefined && Number.isNaN(Date.parse(result))) throw Error(`${label} 날짜가 올바르지 않습니다.`);
  return result;
}
function target(row: Record<string, unknown>): TargetRequest & { contentHash: string } {
  return {
    paperId: identifier(row.paperId, "시험지")!, questionId: identifier(row.questionId, "문항")!,
    atomId: identifier(row.atomId, "atom", true), contentHash: text(row.contentHash, "본문 확인값", 100)!,
  };
}
function parseAnchor(value: unknown, anchorText: string | undefined, atomId: string | undefined): AnchorMeta | undefined {
  if (value == null) return undefined;
  const row = object(value, "메모 연결 위치");
  if (typeof row.section !== "string" || !anchorSections.has(row.section) || !Number.isSafeInteger(row.start)
    || !Number.isSafeInteger(row.end) || (row.start as number) < 0 || (row.end as number) < (row.start as number)
    || !anchorText || (row.section.startsWith("atom") && !atomId)) throw Error("메모의 연결 위치가 올바르지 않습니다.");
  return { section: row.section, start: row.start as number, end: row.end as number,
    prefix: text(row.prefix, "선택 문장 앞부분", 300, true) ?? "", suffix: text(row.suffix, "선택 문장 뒷부분", 300, true) ?? "" };
}
function parseNote(value: unknown): PersonalNote {
  const row = object(value, "메모"), destination = target(row);
  if (typeof row.body !== "string") throw Error("메모 내용은 문자열이어야 합니다.");
  const color = row.color ?? "yellow";
  if (typeof color !== "string" || !noteColors.has(color)) throw Error("메모 색상이 올바르지 않습니다.");
  if (row.resolved != null && typeof row.resolved !== "boolean") throw Error("메모 해결 여부가 올바르지 않습니다.");
  if (row.localOnly != null && typeof row.localOnly !== "boolean") throw Error("메모 저장 상태가 올바르지 않습니다.");
  const anchorText = text(row.anchorText, "선택 문장", 12_000, true);
  return { id: identifier(row.id, "메모")!, ...destination, body: text(row.body, "메모 내용", 30_000, true) ?? "",
    color, resolved: row.resolved === true, anchorText,
    anchorMeta: parseAnchor(row.anchorMeta, anchorText, destination.atomId),
    revision: revision(row.revision, "메모"), createdAt: timestamp(row.createdAt, "메모 작성"),
    updatedAt: timestamp(row.updatedAt, "메모 수정"), localOnly: row.localOnly === true };
}
function parseReview(value: unknown): PersonalReview {
  const row = object(value, "검토 기록");
  if (typeof row.detail !== "string") throw Error("검토 내용은 문자열이어야 합니다.");
  if (typeof row.status !== "string" || !statuses.has(row.status)) throw Error("검토 결과가 올바르지 않습니다.");
  return { ...target(row), id: identifier(row.id, "검토 기록", true), status: row.status as PersonalReview["status"],
    detail: text(row.detail, "검토 내용", 20_000, true) ?? "", revision: revision(row.revision, "검토 기록"),
    createdAt: timestamp(row.createdAt, "검토 작성"), updatedAt: timestamp(row.updatedAt, "검토 수정") };
}
function parseReviewDraft(value: unknown): ReviewDraft {
  const row = object(value, "검토 초안"), parsed = parseReview(row);
  return { paperId: parsed.paperId, questionId: parsed.questionId, atomId: parsed.atomId,
    status: parsed.status, detail: parsed.detail, contentHash: parsed.contentHash,
    expectedRevision: revision(row.expectedRevision, "검토 초안") };
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) throw Error(`${label} 목록이 올바르지 않거나 너무 큽니다.`);
  return value;
}
export function parseRecordExport(value: unknown): RecordExport {
  const row = object(value, "기록 파일");
  if (!["personalNotes", "unsavedNoteDrafts", "personalReviews", "unsavedReviewDrafts"].some(key => Object.hasOwn(row, key))) {
    throw Error("‘전체 기록 내보내기’로 받은 JSON 파일을 선택해 주세요.");
  }
  const personalNotes = list(row.personalNotes ?? [], "메모").map(parseNote);
  const unsavedNoteDrafts = list(row.unsavedNoteDrafts ?? [], "메모 초안").map(value => ({ ...parseNote(value), localOnly: true }));
  const personalReviews = list(row.personalReviews ?? [], "검토 기록").map(parseReview);
  const unsavedReviewDrafts = list(row.unsavedReviewDrafts ?? [], "검토 초안").map(parseReviewDraft);
  if (personalNotes.length + unsavedNoteDrafts.length + personalReviews.length + unsavedReviewDrafts.length > MAX_RECORDS) throw Error("한 번에 가져올 수 있는 기록은 20,000개입니다.");
  return { personalNotes, unsavedNoteDrafts, personalReviews, unsavedReviewDrafts };
}
export function parseLocalDrafts(raw: string | null): DraftState {
  if (raw == null) return { notes: [], reviews: {} };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("이 브라우저의 기존 초안을 읽을 수 없어 가져오기를 중단했습니다."); }
  const row = object(value, "기존 초안"), reviews = object(row.reviews ?? {}, "기존 검토 초안");
  const result: DraftState = { notes: list(row.notes ?? [], "기존 메모 초안").map(parseNote), reviews: {} };
  for (const [key, value] of Object.entries(reviews)) {
    const item = parseReviewDraft(value);
    if (reviewKey(item) !== key) throw Error("기존 검토 초안의 문항 연결이 일치하지 않습니다.");
    result.reviews[key] = item;
  }
  return result;
}

function sameTarget(a: TargetRequest, b: TargetRequest) { return reviewKey(a) === reviewKey(b); }
function noteContent(row: PersonalNote) {
  return JSON.stringify([row.paperId, row.questionId, row.atomId ?? "", row.body, row.color ?? "yellow", row.resolved === true,
    row.anchorText ?? "", row.anchorMeta ? [row.anchorMeta.section, row.anchorMeta.prefix, row.anchorMeta.suffix, row.anchorMeta.start, row.anchorMeta.end] : null, row.contentHash]);
}
function reviewContent(row: PersonalReview | ReviewDraft) {
  return JSON.stringify([reviewKey(row), row.status, row.detail, row.contentHash]);
}
async function restoredId(note: PersonalNote) {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(note.id + "\n" + noteContent(note)));
  return "draft-import-" + Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function mergeImportedRecords(input: RecordExport, current: DraftState, serverNotes: PersonalNote[],
  serverReviews: PersonalReview[], resolveTarget: TargetResolver): Promise<{ drafts: DraftState; summary: ImportSummary }> {
  const drafts: DraftState = { notes: current.notes.map(row => ({ ...row })), reviews: { ...current.reviews } };
  const summary: ImportSummary = { notesAdded: 0, reviewsAdded: 0, duplicatesSkipped: 0, copiesPreserved: 0, changedQuestions: 0 };
  const serverNoteMap = new Map(serverNotes.map(row => [row.id, row]));
  const serverReviewMap = new Map(serverReviews.map(row => [reviewKey(row), row]));
  const verified = new Map<string, ImportTarget>();
  const changed = new Set<string>();
  for (const row of [...input.personalNotes, ...input.unsavedNoteDrafts, ...input.personalReviews, ...input.unsavedReviewDrafts]) {
    const key = `${row.paperId}::${row.questionId}`;
    let resolved = verified.get(key);
    if (!resolved) {
      resolved = await resolveTarget(row);
      if (resolved) verified.set(key, resolved);
    }
    if (!resolved || resolved.paperId !== row.paperId || resolved.questionId !== row.questionId
      || (row.atomId && !resolved.atomIds.includes(row.atomId))) {
      throw Error(`기록에 연결된 문항 또는 atom을 찾을 수 없습니다: ${row.paperId} / ${row.questionId}${row.atomId ? ` / ${row.atomId}` : ""}. 가져오기를 중단했습니다.`);
    }
    if (resolved.contentHash !== row.contentHash) changed.add(key);
  }
  summary.changedQuestions = changed.size;
  const seenNotes = new Map<string, PersonalNote>();
  const savedInBackup = new Map(input.personalNotes.map(row => [row.id, row]));
  for (const {original, draft} of [...input.personalNotes.map(original => ({original,draft:false})),
    ...input.unsavedNoteDrafts.map(row => ({original:{...row,localOnly:true},draft:true}))]) {
    const seenKey = `${draft ? "draft" : "saved"}:${original.id}`;
    const backedUp = savedInBackup.get(original.id);
    if (draft && backedUp && !sameTarget(backedUp, original)) throw Error("백업의 메모와 수정 초안이 다른 문항에 연결되어 있습니다. 가져오기를 중단했습니다.");
    const repeated = seenNotes.get(seenKey);
    if (repeated && noteContent(repeated) !== noteContent(original)) throw Error("같은 메모 번호에 서로 다른 내용이 들어 있습니다. 파일을 확인해 주세요.");
    seenNotes.set(seenKey, original);
    const saved = serverNoteMap.get(original.id);
    if (saved && !sameTarget(saved, original)) throw Error("같은 메모 번호가 다른 문항에 연결되어 있습니다. 가져오기를 중단했습니다.");
    if (saved && (!original.localOnly || noteContent(saved) === noteContent(original))) { summary.duplicatesSkipped++; continue; }
    const incoming: PersonalNote = { ...original, localOnly: true };
    if (!saved && !incoming.id.startsWith("draft-")) {
      incoming.id = await restoredId(original); incoming.revision = undefined;
    }
    const existing = drafts.notes.find(row => row.id === incoming.id);
    if (existing && !sameTarget(existing, incoming)) throw Error("현재 초안과 가져올 메모의 문항이 다릅니다. 가져오기를 중단했습니다.");
    if (existing && noteContent(existing) === noteContent(incoming)) { summary.duplicatesSkipped++; continue; }
    if (existing) {
      incoming.id = await restoredId(original); incoming.revision = undefined;
      const copy = drafts.notes.find(row => row.id === incoming.id);
      if (copy && noteContent(copy) === noteContent(incoming)) { summary.duplicatesSkipped++; continue; }
      if (copy) throw Error("복구할 메모 번호가 다른 초안과 겹칩니다. 가져오기를 중단했습니다.");
      summary.copiesPreserved++;
    }
    if (incoming.id.startsWith("draft-")) incoming.revision = undefined;
    drafts.notes.push(incoming); summary.notesAdded++;
  }
  const pendingReviews = new Map<string, ReviewDraft>();
  for (const row of input.personalReviews) {
    const key = reviewKey(row);
    if (serverReviewMap.has(key)) { summary.duplicatesSkipped++; continue; }
    const item = { paperId: row.paperId, questionId: row.questionId, atomId: row.atomId,
      contentHash: row.contentHash, status: row.status, detail: row.detail };
    const prior = pendingReviews.get(key);
    if (prior && reviewContent(prior) !== reviewContent(item)) throw Error("한 문항에 서로 다른 검토 기록이 들어 있습니다. 파일을 확인해 주세요.");
    pendingReviews.set(key, item);
  }
  const seenDrafts = new Map<string, ReviewDraft>();
  for (const row of input.unsavedReviewDrafts) {
    const key = reviewKey(row), prior = seenDrafts.get(key);
    if (prior && reviewContent(prior) !== reviewContent(row)) throw Error("한 문항에 서로 다른 검토 초안이 들어 있습니다. 파일을 확인해 주세요.");
    seenDrafts.set(key, row);
    const saved = serverReviewMap.get(key);
    if (saved && reviewContent(saved) === reviewContent(row)) { summary.duplicatesSkipped++; continue; }
    pendingReviews.set(key, { ...row });
  }
  for (const [key, row] of pendingReviews) {
    const existing = drafts.reviews[key];
    if (existing && reviewContent(existing) !== reviewContent(row)) {
      throw Error(`문항 ${row.questionId}에 다른 검토 초안이 있습니다. 현재 초안을 저장한 뒤 다시 가져와 주세요. 기존 내용은 변경하지 않았습니다.`);
    }
    if (existing) { summary.duplicatesSkipped++; continue; }
    drafts.reviews[key] = row; summary.reviewsAdded++;
  }
  return { drafts, summary };
}
