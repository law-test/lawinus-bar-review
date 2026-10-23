import { useEffect, useRef, useState } from "react";
import type { PersonalNote, PersonalReview } from "./review-types";
import { MAX_IMPORT_BYTES, mergeImportedRecords, parseLocalDrafts, parseRecordExport } from "./import-records-core";
import type { DraftState, ImportSummary, TargetResolver } from "./import-records-core";

export type ImportRecordsButtonProps = {
  userId: string;
  onImported: (drafts: DraftState, summary: ImportSummary) => void;
  serverNotes?: PersonalNote[];
  serverReviews?: PersonalReview[];
  getServerRecords?: () => Promise<{ notes: PersonalNote[]; reviews: PersonalReview[] } | undefined>;
  resolveTarget?: TargetResolver;
};

export function ImportRecordsButton({ userId, onImported, serverNotes, serverReviews, getServerRecords, resolveTarget }: ImportRecordsButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const activeUser = useRef(userId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  activeUser.current = userId;
  useEffect(() => { generation.current++; setBusy(false); setMessage(""); return () => { generation.current++; }; }, [userId]);

  const importFile = async (file: File) => {
    const attempt = ++generation.current;
    const originalUser = userId;
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (!userId || userId === "guest") throw Error("로그인한 뒤 기록을 가져와 주세요.");
      if (!resolveTarget || !serverNotes || !serverReviews) throw Error("저장된 기록과 문제 목록을 불러온 뒤 다시 가져와 주세요.");
      if (!file.name.toLowerCase().endsWith(".json")) throw Error("‘전체 기록 내보내기’로 받은 JSON 파일을 선택해 주세요.");
      if (file.size > MAX_IMPORT_BYTES) throw Error("기록 파일이 20MB를 초과합니다.");
      const storageKey = `law-review:drafts:v1:${originalUser}`;
      const before = localStorage.getItem(storageKey);
      const current = parseLocalDrafts(before);
      let value: unknown;
      try { value = JSON.parse((await file.text()).replace(/^\uFEFF/, "")); }
      catch { throw Error("JSON 파일을 읽을 수 없습니다. 원본 내보내기 파일을 선택해 주세요."); }
      const parsed = parseRecordExport(value);
      const latest = getServerRecords ? await getServerRecords() : { notes: serverNotes, reviews: serverReviews };
      if (!latest) throw Error("저장된 기록을 다시 확인하지 못했습니다. 잠시 후 가져와 주세요.");
      if (generation.current !== attempt || activeUser.current !== originalUser) return;
      const result = await mergeImportedRecords(parsed, current, latest.notes, latest.reviews, resolveTarget);
      if (generation.current !== attempt || activeUser.current !== originalUser) return;
      if (localStorage.getItem(storageKey) !== before) throw Error("가져오는 동안 초안이 변경되었습니다. 현재 내용을 보존했으니 다시 가져와 주세요.");
      try { localStorage.setItem(storageKey, JSON.stringify(result.drafts)); }
      catch { throw Error("브라우저에 초안을 보관할 공간이 없습니다. 기존 기록은 변경하지 않았습니다."); }
      onImported(result.drafts, result.summary);
      const counts = result.summary;
      setMessage(`메모 ${counts.notesAdded}개와 검토 ${counts.reviewsAdded}개를 초안으로 가져왔습니다. 이미 있는 기록 ${counts.duplicatesSkipped}개는 유지했습니다.${counts.copiesPreserved ? ` 다른 내용의 메모 ${counts.copiesPreserved}개는 별도 초안으로 보관했습니다.` : ""}${counts.changedQuestions ? ` 본문이 바뀐 문항 ${counts.changedQuestions}개는 연결 내용을 확인해 주세요.` : ""} 각 초안을 확인한 뒤 저장해 주세요.`);
    } catch (error) {
      if (generation.current !== attempt || activeUser.current !== originalUser) return;
      setFailed(true); setMessage(error instanceof Error ? error.message : "기록을 가져오지 못했습니다. 기존 기록은 유지됩니다.");
    } finally {
      if (generation.current === attempt && activeUser.current === originalUser) setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return <span className="br-import-records">
    <button type="button" className="br-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "기록 확인 중…" : "기록 가져오기"}</button>
    <input ref={input} type="file" accept=".json,application/json" hidden aria-label="가져올 기록 JSON 파일"
      onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void importFile(file); }} />
    {message && <span role={failed ? "alert" : "status"} style={{ display: "block", maxWidth: "52rem", marginTop: "0.5rem", fontSize: "0.85rem", lineHeight: 1.6 }}>{message}</span>}
  </span>;
}
