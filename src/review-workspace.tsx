"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check,
  CheckCircle2, ChevronDown, ChevronRight, Circle, CircleAlert, FileText,
  GripVertical, Library, LoaderCircle, MessageSquareText, PenLine, Plus,
  RotateCcw, Scale, Search, StickyNote, Trash2, X,
} from "lucide-react";
import type {
  AnchorMeta, ExamIndex, NoteEditor, PaperIndex, PersonalNote, PersonalReview,
  ReviewAtom, ReviewCatalog, ReviewDraft, ReviewPaper, ReviewQuestion, ReviewReference,
  ReviewUser, SelectionAnchor,
} from "./review-types";
import "./review.css";
import {appFetch as fetch, hydrateMaterialLinks, supabase} from "./backend";
import {collectRecordBackup, reconnectNote} from "./record-backup";
import type {SavedRecords, HistoryPage} from "./record-backup";
import { ImportRecordsButton } from "./import-records";
import RecordHistory from "./record-history";
import type { TargetRequest } from "./import-records-core";
import { ReviewPaperCache } from "./paper-cache";
import { referenceDisplayHtml } from "./source-display";

const RECONNECT = "/";
const COLLATOR = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const WIDTH_KEY = "law-review:columns:v1";
const NAV_KEY = "law-review:location:v1";
const NOTE_COLORS = ["yellow", "green", "pink", "blue"];
const markdownText = (value: string) => value.replace(/\\/g, "\\\\").replace(/[<>\[\]`*_#|]/g, "\\$&");
const reviewNames = { clear: "오류 없음", error: "오류 있음", unreviewed: "미검증" };
const referenceNames = { law: "조문", case: "판례", source: "자료", unresolved: "확인 필요" };
const textOnly = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const shortQuestionHeading = (text: string) => {
  const compact = text.trim().replace(/\s+/g, "");
  if (compact.length > 24) return null;
  const title = compact.replace(/^[〈《【「\[(<]/, "").replace(/[〉》】」\])>]$/, "");
  return /^제\d+문(?:의\d+)?$/.test(title) ? title : null;
};
const qElementId = (id: string) => `review-question-${id}`;
const keyFor = (paperId: string, questionId: string, atomId?: string) => `${paperId}::${questionId}${atomId ? `::atom:${atomId}` : ""}`;
const dateLabel = (value?: string) => {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR");
};
const newId = () => `draft-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function persistLocal(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
async function readPaperResponse(response: Response): Promise<ReviewPaper> {
  if (!response.ok) throw new Error("Paper request failed");
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Fetch may already have decoded Content-Encoding. Inspect the actual bytes.
  if (bytes.length >= 2 && bytes[0] === 31 && bytes[1] === 139) {
    if (typeof DecompressionStream === "undefined") throw new Error("Gzip decompression is unavailable");
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as ReviewPaper;
  }
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as ReviewPaper;
}
function friendlyError(status: number, code?: string) {
  if (status === 401) return "기록 저장 연결을 확인하지 못했습니다. 새로고침한 뒤 다시 시도해 주세요. 작성한 내용은 초안으로 남겨 두었습니다.";
  if (code === "content_changed") return "본문이 변경되었습니다. 최신 문제를 다시 불러온 뒤 저장해 주세요. 작성한 내용은 초안으로 남겨 두었습니다.";
  if (status === 409) return "다른 곳에서 기록이 변경되었습니다. 저장된 내용과 비교한 뒤 다시 저장해 주세요.";
  return "기록을 저장하지 못했습니다. 작성한 내용은 초안으로 남겨 두었습니다. 다시 시도해 주세요.";
}
class RecordError extends Error {
  constructor(public status: number, public current?: PersonalNote | PersonalReview, public code?: string) { super(friendlyError(status, code)); }
}
async function recordRequest<T>(url: string, method: string, data?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: "same-origin", headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  let result: Record<string, unknown> = {};
  try { result = await response.json(); } catch { /* The status below also covers non-JSON errors. */ }
  if (!response.ok) throw new RecordError(response.status, result.current as PersonalNote | PersonalReview | undefined, result.error as string | undefined);
  return (result.note ?? result.review ?? result.record ?? result) as T;
}

async function readSavedRecords(): Promise<SavedRecords> {
  const response = await fetch("/api/records", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw Error("저장된 기록을 확인하지 못했습니다.");
  const data = await response.json() as SavedRecords;
  if (!Array.isArray(data.notes) || !Array.isArray(data.reviews)) throw Error("저장된 기록을 확인하지 못했습니다.");
  return data;
}
async function readHistoryPage(offset: number): Promise<HistoryPage> {
  const {data,error} = await supabase.rpc("bar_review_record_history", {page_offset: offset});
  if (error || data?.status !== 200 || !Array.isArray(data.data?.history) || typeof data.data.hasMore !== "boolean") {
    throw Error("변경 이력 전체를 확인하지 못했습니다.");
  }
  return data.data as HistoryPage;
}

function StatusBadge({ review, hash }: { review?: PersonalReview; hash?: string }) {
  const stale = !!review && review.status !== "unreviewed" && !!hash && review.contentHash !== hash;
  const status = stale ? "stale" : review?.status ?? "unreviewed";
  return <span className={`br-status br-status-${status}`}>
    {status === "clear" ? <CheckCircle2 size={13} /> : status === "error" || status === "stale" ? <CircleAlert size={13} /> : <Circle size={12} />}
    {stale ? "재검토 필요" : reviewNames[status as keyof typeof reviewNames]}
  </span>;
}

function Separator({ side, value, onChange, onReset }: {
  side: "left" | "right"; value: number; onChange: (width: number) => void; onReset: () => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); onChange(value + (event.key === "ArrowRight" ? step : -step) * direction);
    } else if (event.key === "Home") { event.preventDefault(); onChange(180); }
    else if (event.key === "End") { event.preventDefault(); onChange(540); }
  };
  return <div className="br-separator" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={side === "left" ? "목차 너비 조절" : "근거와 부전지 너비 조절"}
    aria-controls={side === "left" ? "br-navigation" : "br-reference-panel"}
    aria-valuemin={180} aria-valuemax={540} aria-valuenow={Math.round(value)}
    aria-valuetext={`${Math.round(value)}픽셀. 좌우 방향키로 조절, Shift와 함께 누르면 크게 조절.`}
    onKeyDown={keyboard} onDoubleClick={onReset}
    onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      start.current = { x: event.clientX, width: value };
      event.currentTarget.setPointerCapture(event.pointerId); document.body.classList.add("br-resizing");
    }}
    onPointerMove={(event) => { if (start.current) onChange(start.current.width + (event.clientX - start.current.x) * direction); }}
    onPointerUp={(event) => { start.current = null; document.body.classList.remove("br-resizing"); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { start.current = null; document.body.classList.remove("br-resizing"); }}>
    <GripVertical size={12} aria-hidden="true" />
  </div>;
}

export default function ReviewWorkspace({ initialUser }: { initialUser: ReviewUser | null }) {
  const [catalog, setCatalog] = useState<ReviewCatalog | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [family, setFamily] = useState<"bar" | "mock">("bar");
  const [examId, setExamId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [paper, setPaper] = useState<ReviewPaper | null>(null);
  const [paperError, setPaperError] = useState("");
  const [paperLoading, setPaperLoading] = useState(false);
  const [paperAttempt, setPaperAttempt] = useState(0);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [requestedQuestion, setRequestedQuestion] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [outline, setOutline] = useState<{ id: string; questionId: string; label: string; sub: boolean }[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState("");
  const [mobileTab, setMobileTab] = useState<"contents" | "reading" | "reference">("reading");
  const [rightTab, setRightTab] = useState<"reference" | "notes">("reference");
  const [activeReferenceId, setActiveReferenceId] = useState("");
  const [widths, setWidths] = useState({ left: 240, right: 340 });
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [reviews, setReviews] = useState<PersonalReview[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<PersonalNote[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [draftsReady, setDraftsReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [guestDraftsAvailable, setGuestDraftsAvailable] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [recordsReady, setRecordsReady] = useState(false);
  const [editor, setEditor] = useState<NoteEditor | null>(null);
  const [noteSourceChecking, setNoteSourceChecking] = useState(false);
  const [noteReconnect, setNoteReconnect] = useState<{id: string; contentHash: string} | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [reviewSaving, setReviewSaving] = useState<Record<string, boolean>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, { message: string; current?: PersonalReview }>>({});
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [allRecordsOpen, setAllRecordsOpen] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("lawinus-bar-open-records") === "1") {
        sessionStorage.removeItem("lawinus-bar-open-records"); setAllRecordsOpen(true);
      }
    } catch { /* The header button still opens the records. */ }
  }, []);
  const [recordSearch, setRecordSearch] = useState("");
  const [recordTab, setRecordTab] = useState<"notes" | "reviews">("notes");
  const [markdownPreview, setMarkdownPreview] = useState<string | null>(null);
  const [markdownBusy, setMarkdownBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [, refreshRecordMetadata] = useState(0);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingNoteJump, setPendingNoteJump] = useState<PersonalNote | null>(null);
  const [anchorWarning, setAnchorWarning] = useState<Record<string, string>>({});
  const paperCache = useRef(new ReviewPaperCache());
  const readingRef = useRef<HTMLElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastRecordTrigger = useRef<HTMLElement | null>(null);
  const scrollLock = useRef(0);
  const workspaceAlive = useRef(true);
  const recordsGeneration = useRef(0);
  const recordWrites = useRef(0);
  const latestEditor = useRef(editor);
  const sourceCheckGeneration = useRef(0);
  latestEditor.current = editor;
  const storageKey = `law-review:drafts:v1:${initialUser?.id ?? "guest"}`;
  useEffect(() => {
    workspaceAlive.current = true;
    return () => { workspaceAlive.current = false; recordsGeneration.current++; sourceCheckGeneration.current++; };
  }, []);
  useEffect(() => { sourceCheckGeneration.current++; setNoteReconnect(null); setNoteSourceChecking(false); }, [editor?.id]);

  const exam = catalog?.exams.find((item) => item.id === examId);
  const paperIndex = catalog?.exams.flatMap((item) => item.papers).find((item) => item.id === paperId);
  const currentQuestion = paper?.questions.find((item) => item.id === activeQuestionId) ?? paper?.questions[0];
  const orderedExams = useMemo(() => (catalog?.exams ?? []).filter((item) => item.family === family)
    .sort((a, b) => b.year - a.year || COLLATOR.compare(String(b.round), String(a.round))), [catalog, family]);
  const reviewMap = useMemo(() => new Map(reviews.map((item) => [keyFor(item.paperId, item.questionId, item.atomId), item])), [reviews]);
  const combinedNotes = useMemo(() => {
    const pending = new Set(noteDrafts.map((item) => item.id));
    return [...noteDrafts.map((item) => ({ ...item, localOnly: true })), ...notes.filter((item) => !pending.has(item.id))]
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
  }, [notes, noteDrafts]);
  const combinedReviews = useMemo(() => {
    const drafts = Object.values(reviewDrafts).map((item) => ({ ...item, revision: item.expectedRevision, localOnly: true } as PersonalReview));
    const draftKeys = new Set(drafts.map((item) => keyFor(item.paperId, item.questionId, item.atomId)));
    return [...drafts, ...reviews.filter((item) => !draftKeys.has(keyFor(item.paperId, item.questionId, item.atomId)))];
  }, [reviews, reviewDrafts]);
  const currentNotes = combinedNotes.filter((item) => item.paperId === paperId && item.questionId === currentQuestion?.id);
  const references = paper?.references ?? [];
  const refMap = useMemo(() => new Map(references.map((item) => [item.id, item])), [references]);
  const relevantReferences = useMemo(() => {
    if (!currentQuestion) return [];
    return [...new Set([...(currentQuestion.referenceIds ?? []), ...currentQuestion.atoms.flatMap((item) => item.referenceIds ?? [])])]
      .map((id) => refMap.get(id)).filter((item): item is ReviewReference => !!item);
  }, [currentQuestion, refMap]);
  const activeReference = refMap.get(activeReferenceId) ?? relevantReferences[0];

  const loadRecords = useCallback(async () => {
    if (!initialUser || recordWrites.current > 0 || !workspaceAlive.current) return;
    const request = ++recordsGeneration.current;
    const current = () => workspaceAlive.current && request === recordsGeneration.current && recordWrites.current === 0;
    setRecordsReady(false);
    try {
      const data = await readSavedRecords();
      if (!current()) return;
      setNotes(data.notes); setReviews(data.reviews);
      setRecordsError(""); setRecordsReady(true);
      return { notes: data.notes, reviews: data.reviews };
    } catch { if (current()) setRecordsError("저장된 기록을 불러오지 못했습니다. 초안은 유지됩니다."); }
  }, [initialUser?.id]);
  const beginRecordWrite = () => { recordsGeneration.current++; recordWrites.current++; };
  const endRecordWrite = () => {
    recordsGeneration.current++; recordWrites.current--;
    if (workspaceAlive.current && recordWrites.current === 0) void loadRecords();
  };

  const loadRawPaper = useCallback(async (index: PaperIndex, signal?: AbortSignal) => {
    return paperCache.current.raw(index.id, async () => {
      const data = await readPaperResponse(await fetch(index.dataUrl, { signal, cache: "no-cache" }));
      if (data.id !== index.id || !Array.isArray(data.questions) || !Array.isArray(data.references)) throw Error("Paper mismatch");
      return { ...data, questions: [...data.questions].sort((a, b) => COLLATOR.compare(String(a.number), String(b.number))) };
    });
  }, []);
  const loadDisplayPaper = useCallback((index: PaperIndex, signal?: AbortSignal) => {
    return paperCache.current.display(index.id, () => loadRawPaper(index, signal), hydrateMaterialLinks);
  }, [loadRawPaper]);
  const resolveImportedTarget = useCallback(async (target: TargetRequest) => {
    const index = catalog?.exams.flatMap(exam => exam.papers).find(item => item.id === target.paperId);
    if (!index) return undefined;
    const raw = await loadRawPaper(index);
    const question = raw.questions.find(item => item.id === target.questionId);
    if (!question) return undefined;
    return { paperId: raw.id, questionId: question.id, atomIds: question.atoms.map(item => item.id), contentHash: question.contentHash };
  }, [catalog, loadRawPaper]);

  useEffect(() => {
    const savedWidths = readLocal<{ left: number; right: number; containerWidth?: number }>(WIDTH_KEY, { left: 240, right: 340 });
    if (Number.isFinite(savedWidths.left) && Number.isFinite(savedWidths.right)) {
      const scale = savedWidths.containerWidth && layoutRef.current && layoutRef.current.clientWidth > 900 ? layoutRef.current.clientWidth / savedWidths.containerWidth : 1;
      setWidths({ left: Math.max(180, Math.min(540, savedWidths.left * scale)), right: Math.max(180, Math.min(540, savedWidths.right * scale)) });
    }
    const stored = readLocal<{ notes: PersonalNote[]; reviews: Record<string, ReviewDraft> }>(storageKey, { notes: [], reviews: {} });
    setNoteDrafts(Array.isArray(stored.notes) ? stored.notes : []); setReviewDrafts(stored.reviews ?? {}); setDraftsReady(true);
    if (initialUser) {
      const guest = readLocal<{ notes: PersonalNote[]; reviews: Record<string, ReviewDraft> }>("law-review:drafts:v1:guest", { notes: [], reviews: {} });
      setGuestDraftsAvailable(!!guest.notes?.length || !!Object.keys(guest.reviews ?? {}).length);
    }
    void loadRecords();
  }, [storageKey, loadRecords]);

  useEffect(() => {
    if (!layoutRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.width;
      if (window.innerWidth <= 900) return;
      setWidths((previous) => {
        const maximum = available - 390;
        if (previous.left + previous.right <= maximum) return previous;
        const left = Math.max(180, Math.min(previous.left, maximum * previous.left / (previous.left + previous.right)));
        const next = { left, right: Math.max(180, maximum - left) };
        persistLocal(WIDTH_KEY, { ...next, containerWidth: available }); return next;
      });
    });
    observer.observe(layoutRef.current); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (draftsReady) setStorageError(!persistLocal(storageKey, { notes: noteDrafts, reviews: reviewDrafts }));
  }, [storageKey, noteDrafts, reviewDrafts, draftsReady]);

  useEffect(() => {
    const controller = new AbortController(); setCatalogError("");
    fetch("/data/catalog.json", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(); return response.json() as Promise<ReviewCatalog>;
    }).then((data: ReviewCatalog) => {
      if (!Array.isArray(data.exams)) throw new Error();
      setCatalog(data);
      const params = new URLSearchParams(window.location.search);
      const saved = readLocal<{ examId?: string; paperId?: string; questionId?: string }>(NAV_KEY, {});
      const desiredPaper = params.get("paper") || saved.paperId;
      const desiredExam = data.exams.find((e) => e.papers.some((p) => p.id === desiredPaper))
        ?? data.exams.find((e) => e.id === params.get("exam"))
        ?? [...data.exams].sort((a, b) => (a.family === "bar" ? 0 : 1) - (b.family === "bar" ? 0 : 1) || b.year - a.year || COLLATOR.compare(String(b.round), String(a.round)))[0];
      if (desiredExam) {
        setFamily(desiredExam.family); setExamId(desiredExam.id);
        setPaperId(desiredExam.papers.some((p) => p.id === desiredPaper) ? desiredPaper! : desiredExam.papers[0]?.id ?? "");
        setRequestedQuestion(params.get("q") || (desiredPaper === saved.paperId ? saved.questionId ?? "" : ""));
      }
    }).catch((error) => { if (error.name !== "AbortError") setCatalogError("문제 목록을 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    if (!catalog || !paperId) return;
    const index = catalog.exams.flatMap((item) => item.papers).find((item) => item.id === paperId);
    if (!index) { setPaperError("이 문서를 찾을 수 없습니다."); return; }
    const controller = new AbortController(); setPaperLoading(true); setPaperError(""); setPaper(null); setSelection(null); setActiveReferenceId("");
    const fetchPaper = loadDisplayPaper(index, controller.signal);
    fetchPaper.then((data) => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.questions) || !Array.isArray(data.references)) throw new Error();
      const sorted = { ...data, questions: [...data.questions].sort((a, b) => COLLATOR.compare(String(a.number), String(b.number))) };
      setPaper(sorted); setPaperLoading(false);
      const wanted = new URLSearchParams(window.location.search).get("q") || requestedQuestion;
      const id = sorted.questions.some((q) => q.id === wanted) ? wanted : sorted.questions[0]?.id ?? "";
      setActiveQuestionId(id); setRequestedQuestion("");
      window.requestAnimationFrame(() => {
        const element = document.getElementById(qElementId(id));
        if (element && id !== sorted.questions[0]?.id) { scrollLock.current = Date.now() + 700; element.scrollIntoView({ block: "start" }); }
        else if (readingRef.current) readingRef.current.scrollTop = 0;
      });
    }).catch((error) => { if (error.name !== "AbortError") { setPaperLoading(false); setPaperError("문제를 불러오지 못했습니다. 다시 시도해 주세요."); } });
    return () => controller.abort();
    // requestedQuestion only selects the destination when a paper is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, paperId, paperAttempt, loadDisplayPaper]);

  useEffect(() => {
    if (!paper || paper.id !== paperId) return;
    const index = catalog?.exams.flatMap(exam => exam.papers).find(item => item.id === paperId);
    if (!index) return;
    let active = true, refreshing = false;
    const refreshLinks = async () => {
      if (!active || refreshing || document.hidden || paperCache.current.displayIsFresh(index.id)) return;
      refreshing = true;
      try {
        const refreshed = await loadDisplayPaper(index);
        if (active) setPaper(current => current?.id === index.id ? refreshed : current);
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setNotice("자료 링크를 갱신하지 못했습니다. 잠시 후 다시 시도합니다. 메모와 초안은 유지됩니다.");
        }
      } finally { refreshing = false; }
    };
    const timer = window.setInterval(() => void refreshLinks(), 60_000);
    const onVisible = () => { if (!document.hidden) void refreshLinks(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [paper?.id, paperId, catalog, loadDisplayPaper]);

  useEffect(() => {
    if (!paper || !readingRef.current) { setOutline([]); return; }
    const next: { id: string; questionId: string; label: string; sub: boolean }[] = [];
    for (const question of paper.questions) {
      const article = document.getElementById(qElementId(question.id));
      const seen = new Set<string>();
      article?.querySelectorAll<HTMLElement>(".br-question-text h1,.br-question-text h2,.br-question-text h3,.br-question-text h4,.br-question-text h5,.br-question-text h6,.br-question-text p").forEach((element) => {
        const label = shortQuestionHeading(element.textContent ?? "");
        if (!label || seen.has(label)) return;
        seen.add(label); const id = element.id || `${qElementId(question.id)}-part-${seen.size}`;
        element.id = id; element.classList.add("br-question-part-anchor");
        next.push({ id, questionId: question.id, label, sub: label.includes("의") });
      });
    }
    setOutline(next); setActiveOutlineId(current => next.some(item => item.id === current) ? current : "");
  }, [paper]);

  const updateAddress = useCallback((nextExam: string, nextPaper: string, questionId?: string, replace = false) => {
    const url = new URL(window.location.href); url.searchParams.set("exam", nextExam); url.searchParams.set("paper", nextPaper);
    if (questionId) url.searchParams.set("q", questionId); else url.searchParams.delete("q");
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    persistLocal(NAV_KEY, { examId: nextExam, paperId: nextPaper, questionId });
  }, []);

  const jumpQuestion = useCallback((id: string, changeAddress = true) => {
    setActiveQuestionId(id); setActiveOutlineId(""); setSelection(null); setActiveReferenceId(""); setMobileTab("reading");
    if (changeAddress) updateAddress(examId, paperId, id);
    scrollLock.current = Date.now() + 800;
    window.requestAnimationFrame(() => document.getElementById(qElementId(id))?.scrollIntoView({ behavior: "auto", block: "start" }));
  }, [examId, paperId, updateAddress]);

  const jumpOutline = (entry: { id: string; questionId: string }) => {
    setActiveQuestionId(entry.questionId); setActiveOutlineId(entry.id); setSelection(null); setMobileTab("reading");
    updateAddress(examId, paperId, entry.questionId); scrollLock.current = Date.now() + 900;
    window.requestAnimationFrame(() => document.getElementById(entry.id)?.scrollIntoView({ block: "start" }));
  };

  const openPaper = useCallback((id: string, questionId = "") => {
    const nextExam = catalog?.exams.find((item) => item.papers.some((item) => item.id === id));
    if (!nextExam) return;
    setFamily(nextExam.family); setExamId(nextExam.id); setMobileTab("reading"); setEditor(null); setSelection(null); setQuestionSearch("");
    updateAddress(nextExam.id, id, questionId || undefined);
    if (id === paperId) { if (questionId) jumpQuestion(questionId, false); return; }
    setRequestedQuestion(questionId); setPaperId(id);
  }, [catalog, paperId, updateAddress, jumpQuestion]);

  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(window.location.search); const id = params.get("paper");
      const nextExam = catalog?.exams.find((e) => e.papers.some((p) => p.id === id));
      if (!nextExam || !id) return;
      setFamily(nextExam.family); setExamId(nextExam.id); setMobileTab("reading"); setActiveReferenceId("");
      const q = params.get("q") ?? "";
      if (id === paperId) { if (q) jumpQuestion(q, false); }
      else { setRequestedQuestion(q); setPaperId(id); }
    };
    window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop);
  }, [catalog, paperId, jumpQuestion]);

  useEffect(() => {
    if (!paper || !readingRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (Date.now() < scrollLock.current) return;
      const first = entries.filter((item) => item.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const id = (first?.target as HTMLElement | undefined)?.dataset.questionId;
      // Passive scroll tracking must not replace a reference the reader chose.
      // Explicit question navigation and opening a paper clear it separately.
      if (id) { setActiveQuestionId(id); updateAddress(examId, paperId, id, true); }
    }, { root: readingRef.current, rootMargin: "0px 0px -65% 0px", threshold: 0 });
    readingRef.current.querySelectorAll(".br-question-section").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [paper, examId, paperId, updateAddress]);

  useEffect(() => { if (editor) window.requestAnimationFrame(() => editorRef.current?.focus()); }, [editor?.id]);
  useEffect(() => {
    if (allRecordsOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!allRecordsOpen && dialogRef.current?.open) dialogRef.current?.close();
  }, [allRecordsOpen]);
  useEffect(() => {
    if (!allRecordsOpen || !catalog) return;
    let cancelled = false;
    const ids = [...new Set([...combinedNotes, ...combinedReviews].map((item) => item.paperId))].filter((id) => !paperCache.current.has(id));
    const load = async () => {
      for (let start = 0; start < ids.length && !cancelled; start += 4) {
        await Promise.allSettled(ids.slice(start, start + 4).map(async (id) => {
          const index = catalog.exams.flatMap((e) => e.papers).find((p) => p.id === id);
          if (!index) return;
          const response = await fetch(index.dataUrl);
          if (!response.ok) return;
          const data = await readPaperResponse(response);
          if (Array.isArray(data.questions) && Array.isArray(data.references)) paperCache.current.set(id, data);
        }));
        if (!cancelled) refreshRecordMetadata((value) => value + 1);
      }
    };
    void load(); return () => { cancelled = true; };
  }, [allRecordsOpen, catalog, combinedNotes, combinedReviews]);
  useEffect(() => {
    if (!notice) return; const id = window.setTimeout(() => setNotice(""), 6500); return () => window.clearTimeout(id);
  }, [notice]);

  const changeWidth = (side: "left" | "right", value: number) => {
    const available = layoutRef.current?.clientWidth ?? window.innerWidth;
    setWidths((previous) => {
      const other = previous[side === "left" ? "right" : "left"];
      const next = { ...previous, [side]: Math.max(180, Math.min(540, available - other - 390, value)) };
      persistLocal(WIDTH_KEY, { ...next, containerWidth: available }); return next;
    });
  };
  const selectReference = (id: string, questionId?: string) => {
    scrollLock.current = Date.now() + 900;
    if (questionId) setActiveQuestionId(questionId);
    if (!refMap.has(id)) { setNotice("이 근거의 본문을 찾을 수 없습니다."); return; }
    setActiveReferenceId(id); setRightTab("reference"); setMobileTab("reference"); setSelection(null);
    window.requestAnimationFrame(() => document.querySelector('.br-reference-detail')?.scrollIntoView({ block: 'start' }));
  };
  const handleReferenceClick = (event: MouseEvent<HTMLElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-reference-id]");
    if (!target) return;
    event.preventDefault(); selectReference(target.dataset.referenceId!, target.closest<HTMLElement>("[data-question-id]")?.dataset.questionId);
  };

  const captureSelection = () => {
    const native = window.getSelection();
    if (!native || native.isCollapsed || !native.rangeCount) { setSelection(null); return; }
    const range = native.getRangeAt(0);
    const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
    const endNode = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
    const region = startNode?.closest<HTMLElement>("[data-anchor-region]");
    if (!region || !readingRef.current?.contains(region) || endNode?.closest("[data-anchor-region]") !== region) { setSelection(null); return; }
    const text = range.toString(); if (!text.trim()) { setSelection(null); return; }
    const questionElement = region.closest<HTMLElement>("[data-question-id]"); const questionId = questionElement?.dataset.questionId;
    if (!questionId) return;
    const before = range.cloneRange(); before.selectNodeContents(region); before.setEnd(range.startContainer, range.startOffset);
    const offset = before.toString().length; const full = region.textContent ?? "";
    const rect = range.getBoundingClientRect();
    setSelection({ questionId, atomId: region.closest<HTMLElement>("[data-atom-id]")?.dataset.atomId,
      text, meta: { section: region.dataset.anchorRegion!, prefix: full.slice(Math.max(0, offset - 80), offset), suffix: full.slice(offset + text.length, offset + text.length + 80), start: offset, end: offset + text.length },
      top: Math.min(window.innerHeight - 60, Math.max(76, rect.bottom + 9)), left: Math.max(12, Math.min(window.innerWidth - 190, rect.left)),
    });
  };

  const upsertDraft = (next: PersonalNote) => setNoteDrafts((previous) => [...previous.filter((item) => item.id !== next.id), { ...next, localOnly: true, updatedAt: new Date().toISOString() }]);
  const startNote = (question: ReviewQuestion, atomId?: string, selected?: SelectionAnchor) => {
    if (noteSaving) { setNotice("메모 저장이 끝나면 새 메모를 작성할 수 있습니다."); return; }
    const draft: NoteEditor = { id: newId(), paperId, questionId: question.id, atomId: atomId ?? selected?.atomId,
      anchorText: selected?.text, anchorMeta: selected?.meta, body: "", color: "yellow", resolved: false,
      contentHash: question.contentHash, localOnly: true, createdAt: new Date().toISOString() };
    setEditor(draft); upsertDraft(draft); setActiveQuestionId(question.id); setRightTab("notes"); setMobileTab("reference"); setSelection(null);
  };
  useEffect(() => {
    if (!selection) return;
    const shortcut = (event: WindowEventMap["keydown"]) => {
      if (event.altKey && event.key.toLowerCase() === "n") {
        const question = paper?.questions.find((q) => q.id === selection.questionId);
        if (question) { event.preventDefault(); startNote(question, selection.atomId, selection); }
      }
      if (event.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
    // startNote uses the selection, paper and current saving state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, paper, noteSaving]);
  const editNote = (note: PersonalNote) => {
    if (noteSaving) { setNotice("메모 저장이 끝나면 수정할 수 있습니다."); return; }
    setEditor({ ...note }); setRightTab("notes"); setMobileTab("reference"); setAllRecordsOpen(false);
  };
  const updateEditor = (patch: Partial<NoteEditor>) => {
    if (!editor || noteSaving) return; const next = { ...editor, ...patch, error: undefined }; setEditor(next); upsertDraft(next);
  };
  const saveNote = async (note = editor) => {
    if (!note || !note.body.trim()) { if (editor) setEditor({ ...editor, error: "메모 내용을 적어 주세요." }); return; }
    setNoteSaving(true); upsertDraft(note); beginRecordWrite();
    try {
      const saved = await recordRequest<PersonalNote>("/api/notes", "PUT", {
        ...(note.id.startsWith("draft-") ? { clientId: note.id } : { id: note.id }), paperId: note.paperId, questionId: note.questionId,
        atomId: note.atomId, anchorText: note.anchorText, anchorMeta: note.anchorMeta, body: note.body,
        color: note.color, resolved: note.resolved, contentHash: note.contentHash, expectedRevision: note.revision,
      });
      if (!workspaceAlive.current) return;
      setNotes((previous) => [...previous.filter((item) => item.id !== saved.id), saved]);
      setNoteDrafts((previous) => previous.filter((item) => item.id !== note.id)); setEditor(null); setNotice("부전지를 저장했습니다.");
    } catch (error) {
      if (!workspaceAlive.current) return;
      const message = error instanceof RecordError ? error.message : friendlyError(0);
      setEditor({ ...note, error: message, conflict: error instanceof RecordError ? error.current as PersonalNote : undefined });
    } finally { endRecordWrite(); if (workspaceAlive.current) setNoteSaving(false); }
  };
  const removeNote = async (note: PersonalNote) => {
    if (!window.confirm("이 메모를 삭제할까요?")) return;
    if (note.id.startsWith("draft-")) { setNoteDrafts((previous) => previous.filter((item) => item.id !== note.id)); if (editor?.id === note.id) setEditor(null); return; }
    beginRecordWrite();
    try {
      await recordRequest(`/api/notes?id=${encodeURIComponent(note.id)}${note.revision === undefined ? "" : `&expectedRevision=${encodeURIComponent(note.revision)}`}`, "DELETE");
      if (!workspaceAlive.current) return;
      setNotes((previous) => previous.filter((item) => item.id !== note.id)); setNoteDrafts((previous) => previous.filter((item) => item.id !== note.id));
      if (editor?.id === note.id) setEditor(null); setNotice("메모를 삭제했습니다.");
    } catch { if (workspaceAlive.current) setNotice("메모를 삭제하지 못했습니다. 다시 시도해 주세요."); }
    finally { endRecordWrite(); }
  };

  const setReviewDraft = (question: ReviewQuestion, patch: Partial<ReviewDraft>, atomId?: string) => {
    const key = keyFor(paperId, question.id, atomId); const old = reviewMap.get(key);
    if (reviewSaving[key]) return;
    setReviewDrafts((previous) => {
      const base = previous[key] ?? { paperId, questionId: question.id, atomId, status: old?.status ?? "unreviewed", detail: old?.detail ?? "", expectedRevision: old?.revision, contentHash: question.contentHash };
      return { ...previous, [key]: { ...base, ...patch, contentHash: question.contentHash } };
    });
    setReviewErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
  };
  const saveReview = async (question: ReviewQuestion, atomId?: string) => {
    const key = keyFor(paperId, question.id, atomId); const previous = reviewMap.get(key);
    const draft = reviewDrafts[key] ?? { paperId, questionId: question.id, atomId, status: previous?.status ?? "unreviewed", detail: previous?.detail ?? "", contentHash: question.contentHash, expectedRevision: previous?.revision };
    if (draft.status === "error" && !draft.detail.trim()) {
      setReviewErrors((all) => ({ ...all, [key]: { message: "발견한 오류를 적어 주세요." } }));
      return;
    }
    setReviewDrafts((all) => ({ ...all, [key]: draft })); setReviewSaving((all) => ({ ...all, [key]: true })); beginRecordWrite();
    try {
      const saved = await recordRequest<PersonalReview>("/api/reviews", "PUT", { ...draft, atomId, contentHash: question.contentHash });
      if (!workspaceAlive.current) return;
      setReviews((all) => [...all.filter((item) => keyFor(item.paperId, item.questionId, item.atomId) !== key), saved]);
      setReviewDrafts((all) => { const next = { ...all }; delete next[key]; return next; });
      setReviewErrors((all) => { const next = { ...all }; delete next[key]; return next; }); setNotice("개인 검증 기록을 저장했습니다.");
    } catch (error) {
      if (!workspaceAlive.current) return;
      setReviewErrors((all) => ({ ...all, [key]: { message: error instanceof RecordError ? error.message : friendlyError(0), current: error instanceof RecordError ? error.current as PersonalReview : undefined } }));
    } finally { endRecordWrite(); if (workspaceAlive.current) setReviewSaving((all) => { const next = { ...all }; delete next[key]; return next; }); }
  };

  const locateNote = useCallback((note: PersonalNote) => {
    const question = paper?.questions.find((q) => q.id === note.questionId);
    const article = document.getElementById(qElementId(note.questionId)); if (!article || !question) return false;
    const atomElement = note.atomId ? Array.from(article.querySelectorAll<HTMLElement>("[data-atom-id]")).find((element) => element.dataset.atomId === note.atomId) : undefined;
    if (atomElement) {
      const previous = atomElement.closest<HTMLDetailsElement>("details[data-retired-atoms]");
      if (previous) previous.open = true;
    }
    setActiveQuestionId(note.questionId); setMobileTab("reading"); scrollLock.current = Date.now() + 900;
    article.scrollIntoView({ block: "start" });
    if (!note.anchorText) {
      atomElement?.scrollIntoView({ block: "center" });
      return true;
    }
    let regions = Array.from(article.querySelectorAll<HTMLElement>("[data-anchor-region]"));
    if (note.atomId) regions = regions.filter((el) => el.closest<HTMLElement>("[data-atom-id]")?.dataset.atomId === note.atomId);
    if (note.anchorMeta?.section) regions = regions.filter((el) => el.dataset.anchorRegion === note.anchorMeta!.section);
    const matches: { element: HTMLElement; start: number; end: number }[] = [];
    for (const element of regions) {
      const content = element.textContent ?? ""; let start = content.indexOf(note.anchorText);
      while (start >= 0) {
        const prefixMatches = !note.anchorMeta?.prefix || content.slice(Math.max(0, start - note.anchorMeta.prefix.length), start) === note.anchorMeta.prefix;
        const suffixMatches = !note.anchorMeta?.suffix || content.slice(start + note.anchorText.length, start + note.anchorText.length + note.anchorMeta.suffix.length) === note.anchorMeta.suffix;
        if (prefixMatches && suffixMatches) matches.push({ element, start, end: start + note.anchorText.length });
        start = content.indexOf(note.anchorText, start + 1);
      }
    }
    if (matches.length !== 1) {
      setAnchorWarning((previous) => ({ ...previous, [note.id]: "연결 위치 확인 필요" })); setNotice("원래 선택한 글의 위치를 확인해 주세요. 인용문과 메모는 보존되어 있습니다."); return true;
    }
    const match = matches[0]; const walker = document.createTreeWalker(match.element, NodeFilter.SHOW_TEXT);
    let offset = 0; let startNode: Node | null = null; let endNode: Node | null = null; let startOffset = 0; let endOffset = 0; let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (!startNode && match.start >= offset && match.start < offset + length) { startNode = node; startOffset = match.start - offset; }
      if (match.end > offset && match.end <= offset + length) { endNode = node; endOffset = match.end - offset; break; } offset += length;
    }
    if (startNode && endNode) {
      const range = document.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); match.element.scrollIntoView({ block: "center" });
      setAnchorWarning((previous) => { const next = { ...previous }; delete next[note.id]; return next; });
    }
    return true;
  }, [paper]);

  const goToNote = (note: PersonalNote) => {
    setAllRecordsOpen(false); setSelection(null);
    if (paperId === note.paperId && paper) { updateAddress(examId, paperId, note.questionId); window.requestAnimationFrame(() => locateNote(note)); }
    else { setPendingNoteJump(note); openPaper(note.paperId, note.questionId); }
  };
  useEffect(() => {
    if (!pendingNoteJump || !paper || paperId !== pendingNoteJump.paperId) return;
    const id = window.setTimeout(() => { locateNote(pendingNoteJump); setPendingNoteJump(null); }, 100); return () => window.clearTimeout(id);
  }, [paper, paperId, pendingNoteJump, locateNote]);

  const exportRecords = async () => {
    if (exportBusy) return;
    setExportError("");
    if (recordWrites.current > 0) { setExportError("기록 저장이 끝난 뒤 내보내 주세요."); return; }
    const generation = recordsGeneration.current;
    const current = () => workspaceAlive.current && recordsGeneration.current === generation && recordWrites.current === 0;
    setExportBusy(true);
    try {
      const backup = await collectRecordBackup({ readRecords: readSavedRecords, readHistory: readHistoryPage,
        isCurrent: current, noteDrafts, reviewDrafts: Object.values(reviewDrafts), catalogVersion: catalog?.version });
      if (!current()) throw Error("기록이 변경되었습니다. 다시 내보내 주세요.");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
      a.download = `민법위키_전체기록_${new Date().toISOString().slice(0, 10)}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("메모·초안·개인 검증·변경 이력을 모두 내보냈습니다.");
    } catch (error) {
      if (workspaceAlive.current) setExportError(`${error instanceof Error ? error.message : "전체 기록을 확인하지 못했습니다."} 백업 파일을 만들지 않았습니다. 초안은 유지됩니다.`);
    } finally { if (workspaceAlive.current) setExportBusy(false); }
  };

  const notesMarkdown = async () => {
    const ids = [...new Set(combinedNotes.map((item) => item.paperId))].filter((id) => !paperCache.current.has(id));
    for (let start = 0; start < ids.length; start += 4) {
      await Promise.allSettled(ids.slice(start, start + 4).map(async (id) => {
        const index = catalog?.exams.flatMap((e) => e.papers).find((p) => p.id === id); if (!index) return;
        await loadRawPaper(index);
      }));
    }
    const lines = ["# 민법위키 부전지", "", `내보낸 날짜: ${new Date().toLocaleString("ko-KR")}`, "", `전체 메모: ${combinedNotes.length}개`, ""];
    const groups = new Map<string, PersonalNote[]>();
    for (const note of combinedNotes) {
      const key = keyFor(note.paperId, note.questionId); groups.set(key, [...(groups.get(key) ?? []), note]);
    }
    for (const group of [...groups.values()].sort((a, b) => COLLATOR.compare(questionName(a[0]), questionName(b[0])))) {
      const first = group[0]; const parent = catalog?.exams.find((exam) => exam.papers.some((p) => p.id === first.paperId));
      const index = parent?.papers.find((p) => p.id === first.paperId);
      const loaded = paperCache.current.get(first.paperId); const question = loaded?.questions.find((q) => q.id === first.questionId);
      lines.push(`## ${markdownText(parent?.title ?? first.paperId)}`, "", `### ${markdownText(index?.title ?? first.paperId)} · ${markdownText(question?.label ?? first.questionId)}`, "");
      const url = new URL(window.location.pathname, window.location.origin); if (parent) url.searchParams.set("exam", parent.id);
      url.searchParams.set("paper", first.paperId); url.searchParams.set("q", first.questionId);
      lines.push(`- [문항 본문 열기](${url.toString()})`, "");
      group.forEach((note, n) => {
        lines.push(`#### 메모 ${n + 1} · ${note.resolved ? "해결" : "미해결"}`, "");
        if (note.localOnly) lines.push("- 저장 전 초안", "");
        if (note.atomId) {
          const atom = question?.atoms.find((item) => item.id === note.atomId);
          lines.push(`- atom: ${markdownText(atom?.label ?? note.atomId)}`, "");
          if (atom?.statement) lines.push(`**atom 문장**`, "", ...atom.statement.split(/\r?\n/).map((line) => `> ${markdownText(line)}`), "");
        }
        if (note.anchorText) lines.push("**선택한 글**", "", ...note.anchorText.split(/\r?\n/).map((line) => `> ${markdownText(line)}`), "");
        if (question && note.contentHash !== question.contentHash) lines.push("- 본문 변경: 인용 위치를 다시 확인할 필요가 있습니다.", "");
        lines.push("**나의 메모**", "", markdownText(note.body || "작성 중인 메모"), "");
        if (note.updatedAt || note.createdAt) lines.push(`수정일: ${dateLabel(note.updatedAt ?? note.createdAt)}`, "");
        lines.push("---", "");
      });
    }
    refreshRecordMetadata((value) => value + 1); return lines.join("\n");
  };
  const openNotesMarkdown = async (download: boolean) => {
    if (markdownBusy) return; setMarkdownBusy(true);
    try {
      const content = await notesMarkdown();
      if (download) {
        const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
        const a = document.createElement("a"); a.href = url; a.download = `민법위키_부전지_${new Date().toISOString().slice(0, 10)}.md`; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else { setMarkdownPreview(content); setRecordTab("notes"); }
    } catch { setNotice("Markdown을 준비하지 못했습니다. 메모는 그대로 보존되어 있습니다."); }
    finally { setMarkdownBusy(false); }
  };

  const questionName = (note: { paperId: string; questionId: string; atomId?: string }) => {
    const info = catalog?.exams.flatMap((e) => e.papers.map((p) => ({ ...p, examTitle: e.title }))).find((p) => p.id === note.paperId);
    const loaded = paperCache.current.get(note.paperId)?.questions.find((q) => q.id === note.questionId);
    return `${info?.examTitle ?? ""} · ${info?.title ?? note.paperId} · ${loaded?.label ?? note.questionId}${note.atomId ? ` · ${loaded?.atoms.find((atom) => atom.id === note.atomId)?.label ?? note.atomId}` : ""}`;
  };
  const reviewAtomStatement = (review: PersonalReview) => review.atomId ? paperCache.current.get(review.paperId)?.questions.find((q) => q.id === review.questionId)?.atoms.find((atom) => atom.id === review.atomId)?.statement ?? "" : "";
  const goToReview = (review: PersonalReview) => goToNote({ id: `review-${review.id ?? review.questionId}`, paperId: review.paperId, questionId: review.questionId, atomId: review.atomId, contentHash: review.contentHash, body: "" });
  const filteredNotes = combinedNotes.filter((note) => (!unresolvedOnly || !note.resolved) && `${note.body} ${note.anchorText ?? ""} ${questionName(note)}`.toLocaleLowerCase().includes(recordSearch.toLocaleLowerCase()));
  const filteredReviews = combinedReviews.filter((review) => (!unresolvedOnly || review.status === "error") && `${review.detail} ${questionName(review)} ${reviewAtomStatement(review)}`.toLocaleLowerCase().includes(recordSearch.toLocaleLowerCase()));

  const reloadCurrentPaper = () => {
    paperCache.current.delete(paperId); setPaperAttempt((value) => value + 1); setCatalogAttempt((value) => value + 1); setNotice("최신 문제를 다시 불러옵니다. 초안은 유지됩니다.");
  };
  const prepareNoteReconnect = async () => {
    const note = latestEditor.current;
    if (!note || noteSaving || noteSourceChecking) return;
    const request = ++sourceCheckGeneration.current;
    const current = () => workspaceAlive.current && request === sourceCheckGeneration.current && latestEditor.current?.id === note.id;
    setNoteSourceChecking(true); setNoteReconnect(null);
    try {
      const parent = catalog?.exams.find(item => item.papers.some(candidate => candidate.id === note.paperId));
      const index = parent?.papers.find(item => item.id === note.paperId);
      if (!parent || !index) throw Error("메모가 연결된 시험지를 찾을 수 없습니다. 기존 메모는 유지됩니다.");
      paperCache.current.delete(note.paperId);
      const latest = await loadRawPaper(index);
      if (!current()) return;
      const candidate = reconnectNote(note, latest);
      setNoteReconnect({id: note.id, contentHash: candidate.contentHash});
      setEditor(value => value?.id === note.id && value.error?.includes("본문이 변경") ? {...value, error: undefined} : value);
      setFamily(parent.family); setExamId(parent.id); setPaperId(note.paperId); setRequestedQuestion(note.questionId);
      updateAddress(parent.id, note.paperId, note.questionId); setPaperAttempt(value => value + 1);
      setMobileTab("reading");
      setNotice("최신 본문과 원래 인용문을 확인한 뒤 메모를 다시 연결해 주세요.");
    } catch (error) {
      if (current()) setEditor(value => value?.id === note.id ? {...value, error: error instanceof Error ? error.message : "최신 본문을 확인하지 못했습니다. 메모는 유지됩니다."} : value);
    } finally { if (current()) setNoteSourceChecking(false); }
  };
  const confirmNoteReconnect = () => {
    if (!editor || !paper || noteSaving || !noteReconnect || noteReconnect.id !== editor.id) return;
    try {
      const next = reconnectNote(editor, paper);
      if (next.contentHash !== noteReconnect.contentHash) throw Error("본문이 다시 변경되었습니다. 최신 본문을 한 번 더 확인해 주세요.");
      const confirmed = {...next, error: undefined, conflict: undefined};
      setEditor(confirmed); upsertDraft(confirmed); setNoteReconnect(null); void saveNote(confirmed);
    } catch (error) { setEditor({...editor, error: error instanceof Error ? error.message : "본문 연결을 확인하지 못했습니다."}); }
  };
  const importGuestDrafts = () => {
    const guest = readLocal<{ notes: PersonalNote[]; reviews: Record<string, ReviewDraft> }>("law-review:drafts:v1:guest", { notes: [], reviews: {} });
    const nextNotes = [...noteDrafts, ...(guest.notes ?? []).filter((item) => !noteDrafts.some((existing) => existing.id === item.id))];
    const nextReviews = { ...(guest.reviews ?? {}), ...reviewDrafts };
    if (!persistLocal(storageKey, { notes: nextNotes, reviews: nextReviews })) { setStorageError(true); return; }
    setNoteDrafts(nextNotes); setReviewDrafts(nextReviews); persistLocal("law-review:drafts:v1:guest", { notes: [], reviews: {} });
    setGuestDraftsAvailable(false); setNotice("이 브라우저에 남아 있던 초안을 가져왔습니다.");
  };

  const renderNote = (note: PersonalNote, full = false) => {
    const loadedQuestion = paperCache.current.get(note.paperId)?.questions.find((q) => q.id === note.questionId);
    const changed = !!loadedQuestion && loadedQuestion.contentHash !== note.contentHash;
    return <article className={`br-note br-note-${NOTE_COLORS.includes(note.color ?? "") ? note.color : "yellow"}`} key={note.id}>
      <div className="br-note-meta"><span>{note.localOnly ? "저장 전 초안" : note.resolved ? "해결한 메모" : "부전지"}</span><time>{dateLabel(note.updatedAt ?? note.createdAt)}</time></div>
      {full && <button className="br-note-location" onClick={() => goToNote(note)}>{questionName(note)} <ArrowUpRight size={12} /></button>}
      {note.anchorText && <button className="br-note-quote" onClick={() => goToNote(note)}>“{note.anchorText}”</button>}
      <p className="br-note-body">{note.body || "작성 중인 메모"}</p>
      {(changed || anchorWarning[note.id]) && <p className="br-note-warning"><CircleAlert size={12} />{anchorWarning[note.id] ?? "본문 변경 · 연결 위치 확인 필요"}</p>}
      <div className="br-note-actions"><button onClick={() => editNote(note)}><PenLine size={12} /> 수정</button>
        <button onClick={() => { const next = { ...note, resolved: !note.resolved }; setEditor(next); void saveNote(next); }} disabled={noteSaving || !note.body.trim()}><Check size={12} /> {note.resolved ? "미해결로" : "해결 표시"}</button>
        <button onClick={() => void removeNote(note)} aria-label="메모 삭제"><Trash2 size={13} /></button></div>
    </article>;
  };

  const refsFor = (ids: string[], qid: string) => ids.length > 0 && <div className="br-inline-refs">{[...new Set(ids)].map((id) => {
    const reference = refMap.get(id); if (!reference) return null;
    return <button key={id} className={activeReferenceId === id ? "is-selected" : ""} onClick={() => selectReference(id, qid)}>
      <span>{referenceNames[reference.kind]}</span>{reference.title}<ArrowUpRight size={11} /></button>;
  })}</div>;

  const renderPersonalReview = (question: ReviewQuestion, atomId?: string, atomLabel?: string) => {
    const reviewKey = keyFor(paperId, question.id, atomId); const review = reviewMap.get(reviewKey); const draft = reviewDrafts[reviewKey];
    const stale = !!review && review.status !== "unreviewed" && review.contentHash !== question.contentHash;
    const form = draft ?? { status: review?.status ?? "unreviewed", detail: review?.detail ?? "" };
    const issue = reviewErrors[reviewKey];
    return <details className={`br-personal-review ${atomId ? "br-atom-review" : ""}`} data-review-scope={atomId ? "atom" : "question"} data-review-atom-id={atomId}><summary><span><span className="br-review-label">{atomId ? "atom 개인 검증" : "문항 개인 검증"}</span><StatusBadge review={review} hash={question.contentHash} />{draft && <span className="br-unsaved-dot" title="저장 전 초안" />}</span><span className="br-review-open">기록하기<ChevronDown size={14} /></span></summary>
        <div className="br-review-form"><p className="br-help">나의 검토 결과입니다. 공식 정답은 변경되지 않습니다.</p>
          {stale && <div className="br-stale-notice"><RotateCcw size={15} /><span>본문이 변경되었습니다. 이전 판단은 ‘{reviewNames[review.status]}’입니다. 현재 내용을 다시 확인해 주세요.</span></div>}
          <fieldset disabled={!!reviewSaving[reviewKey]}><legend className="br-sr-only">{question.label} {atomLabel ?? "문항"} 개인 검증 결과</legend><div className="br-review-options">{(["unreviewed", "clear", "error"] as const).map((status) => <label key={status} className={form.status === status ? "is-selected" : ""}><input type="radio" name={`review-${question.id}-${atomId ?? "question"}`} checked={form.status === status} onChange={() => setReviewDraft(question, { status }, atomId)} />{reviewNames[status]}</label>)}</div></fieldset>
          <label className="br-field-label" htmlFor={`review-detail-${question.id}-${atomId ?? "question"}`}>{form.status === "error" ? "발견한 오류" : "검토 메모"}<span>{form.status === "error" ? "필수" : "선택"}</span></label>
          <textarea id={`review-detail-${question.id}-${atomId ?? "question"}`} disabled={!!reviewSaving[reviewKey]} value={form.detail} rows={3} aria-required={form.status === "error"} placeholder="어떤 부분을 확인했는지 자유롭게 적어 주세요." onChange={(event) => setReviewDraft(question, { detail: event.target.value }, atomId)} />
          {issue && <div className="br-form-error" role="alert"><p>{issue.message}</p>{issue.message.includes("본문이 변경") && <button className="br-text-button" onClick={reloadCurrentPaper}>최신 문제 다시 불러오기</button>}{issue.current && <><p className="br-conflict-current">저장된 판단: {reviewNames[issue.current.status]}{issue.current.detail && ` · ${issue.current.detail}`}</p><button className="br-text-button" onClick={() => setReviewDraft(question, { expectedRevision: issue.current!.revision }, atomId)}>위 기록을 확인했습니다. 내 판단으로 다시 저장</button></>}{!initialUser && <a href={RECONNECT} target="_top">다시 연결하기 <ArrowUpRight size={12} /></a>}</div>}
          <div className="br-review-save"><button className="br-button br-button-primary" disabled={!!reviewSaving[reviewKey]} onClick={() => void saveReview(question, atomId)}>{!!reviewSaving[reviewKey] ? <LoaderCircle size={14} className="br-spin" /> : <Check size={14} />}{stale ? "현재 내용의 검증 기록 저장" : "검증 기록 저장"}</button>{review?.updatedAt && <span>{dateLabel(review.updatedAt)}</span>}</div>
        </div></details>;
  };

  const renderAtom = (question: ReviewQuestion, atom: ReviewAtom, atomIndex: number) => <article className="br-atom" key={atom.id} data-atom-id={atom.id}>
    <span className="br-atom-number">{String(atomIndex + 1).padStart(2, "0")}</span><div className="br-atom-main">
      <div className="br-atom-heading"><span>{atom.label}</span><span className="br-atom-tools">{atom.answer && <b className={`br-answer br-answer-${atom.answer.toLowerCase()}`}>{atom.answer}</b>}<button className="br-icon-button" aria-label={`${atom.label}에 메모 붙이기`} onClick={() => startNote(question, atom.id)}><Plus size={15} /></button></span></div>
      <p className="br-atom-statement" data-anchor-region="atom-statement">{atom.statement}</p>
      {atom.explanationHtml && <div className="br-prose br-atom-explanation" data-anchor-region="atom-explanation" dangerouslySetInnerHTML={{ __html: atom.explanationHtml }} />}
      {refsFor(atom.referenceIds ?? [], question.id)}
      {renderPersonalReview(question, atom.id, atom.label)}
    </div></article>;

  const renderQuestion = (question: ReviewQuestion, index: number) => {
    const noteCount = combinedNotes.filter((note) => note.paperId === paperId && note.questionId === question.id).length;
    const currentAtoms = question.atoms.filter((atom) => !atom.retired).sort((a, b) => COLLATOR.compare(a.label, b.label));
    const previousAtoms = question.atoms.filter((atom) => atom.retired).sort((a, b) => COLLATOR.compare(a.label, b.label));
    return <section className="br-question-section" id={qElementId(question.id)} data-question-id={question.id} key={question.id} aria-labelledby={`heading-${question.id}`}>
      <div className="br-question-kicker"><span>{paper?.subject} · {paper?.kind}</span><span>{String(index + 1).padStart(2, "0")} / {paper?.questions.length}</span></div>
      <div className="br-question-heading"><h2 id={`heading-${question.id}`}>{question.label}</h2><button className="br-icon-button" title="이 문항에 메모" aria-label={`${question.label}에 메모 붙이기`} onClick={() => startNote(question)}><StickyNote size={18} /></button></div>
      {question.title && question.title !== question.label && <p className="br-question-title">{question.title}</p>}
      {question.availability === "missing" ? <div className="br-empty-inline"><FileText size={24} /><p>문제 원문을 확인할 자료가 없습니다.</p>{question.source?.map((source, n) => <a key={n} href={source.url} target="_blank" rel="noreferrer">{source.label} <ArrowUpRight size={12} /></a>)}</div>
        : <div className="br-prose br-question-text" data-anchor-region="question" dangerouslySetInnerHTML={{ __html: question.questionHtml }} />}
      {question.source?.length > 0 && question.availability !== "missing" && <div className="br-question-sources">{question.source.map((source, n) => <a href={source.url} key={n} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={11} /></a>)}</div>}
      {question.explanationHtml && <div className="br-explanation"><div className="br-section-label"><span className="br-small-rule" />해설</div>
        <div className="br-prose br-explanation-text" data-anchor-region="explanation" dangerouslySetInnerHTML={{ __html: question.explanationHtml }} />
        {refsFor(question.referenceIds ?? [], question.id)}</div>}
      {question.atoms.length > 0 && <div className="br-atoms"><div className="br-section-label"><span className="br-small-rule" />풀이 atom <span className="br-count">{currentAtoms.length}</span></div>
        <div className="br-current-atoms">{currentAtoms.map((atom, atomIndex) => renderAtom(question, atom, atomIndex))}</div>
        {previousAtoms.length > 0 && <details className="br-retired-atoms" data-retired-atoms><summary>이전 문장과 기록 <span className="br-count">{previousAtoms.length}</span></summary>
          {previousAtoms.map((atom, atomIndex) => renderAtom(question, atom, atomIndex))}
        </details>}
      </div>}
      {renderPersonalReview(question)}
      <button className="br-question-note-link" onClick={() => { setActiveQuestionId(question.id); setRightTab("notes"); setMobileTab("reference"); }}><MessageSquareText size={14} />이 문항의 메모 <b>{noteCount}</b><ArrowRight size={13} /></button>
    </section>;
  };

  const paperGroups = useMemo(() => {
    const groups = new Map<string, PaperIndex[]>();
    for (const item of exam?.papers ?? []) groups.set(item.subject, [...(groups.get(item.subject) ?? []), item]);
    return [...groups.entries()];
  }, [exam]);
  const activeIndex = paper?.questions.findIndex((q) => q.id === currentQuestion?.id) ?? 0;
  const layoutStyle = { "--br-left": `${widths.left}px`, "--br-right": `${widths.right}px` } as CSSProperties;

  return <div className="br-workspace" style={layoutStyle}>
    <a className="br-skip-link" href="#br-reading">문제 본문으로 이동</a>
    <header className="br-header"><a className="br-brand" href="/" aria-label="변호사시험 검토실 처음으로"><span className="br-brand-symbol" aria-hidden="true">§</span><span><b>민법위키 하랑재</b><small>변호사시험 검토실</small></span></a>
      <div className="br-header-center"><span className="br-header-rule" />문제 · 해설 · 근거를 한눈에<span className="br-header-rule" /></div>
      <div className="br-header-actions"><button className="br-my-records" onClick={(event) => { lastRecordTrigger.current = event.currentTarget; setAllRecordsOpen(true); }}><Library size={16} /><span>내 기록</span>{combinedNotes.length > 0 && <b>{combinedNotes.length}</b>}</button>
        {initialUser ? <span className="br-user" title={initialUser.email}><span>{(initialUser.name || "나").slice(0, 1)}</span><b>{initialUser.name || "내 계정"}</b></span> : <a className="br-login" href={RECONNECT} target="_top">다시 연결<ArrowUpRight size={13} /></a>}</div></header>
    <nav className="br-mobile-tabs" aria-label="학습 화면"><button className={mobileTab === "contents" ? "is-active" : ""} onClick={() => setMobileTab("contents")}><BookOpen size={15} />목차</button><button className={mobileTab === "reading" ? "is-active" : ""} onClick={() => setMobileTab("reading")}><FileText size={15} />문제</button><button className={mobileTab === "reference" ? "is-active" : ""} onClick={() => setMobileTab("reference")}><StickyNote size={15} />근거 · 부전지</button></nav>
    {(recordsError || storageError) && <div className="br-top-warning" role="status"><CircleAlert size={14} /><span>{storageError ? "이 브라우저에 초안을 보관할 수 없습니다. 작성한 내용을 복사하거나 내보내 주세요." : recordsError}</span>{recordsError && <button onClick={() => void loadRecords()}>다시 불러오기</button>}</div>}
    {guestDraftsAvailable && <div className="br-top-warning"><StickyNote size={14} /><span>이 브라우저에 가져올 수 있는 초안이 있습니다.</span><button onClick={importGuestDrafts}>초안 가져오기</button></div>}
    <div className="br-layout" ref={layoutRef}>
      <aside className={`br-navigation ${mobileTab === "contents" ? "br-mobile-active" : ""}`} id="br-navigation" aria-label="시험과 문항 목차">
        <div className="br-nav-top"><p className="br-eyebrow">THE LAW LIBRARY</p><h1>문제 목차</h1><div className="br-family-switch" aria-label="시험 종류">{(["bar", "mock"] as const).map((value) => <button key={value} aria-pressed={family === value} className={family === value ? "is-active" : ""} onClick={() => { const next = [...(catalog?.exams ?? [])].filter((e) => e.family === value).sort((a, b) => b.year - a.year || COLLATOR.compare(String(b.round), String(a.round)))[0]; setFamily(value); if (next) { setExamId(next.id); if (next.papers[0]) openPaper(next.papers[0].id); } }}>{value === "bar" ? "변호사시험" : "모의시험"}</button>)}</div>
          <label className="br-field-label" htmlFor="br-exam">회차</label><div className="br-select-wrap"><select id="br-exam" value={examId} onChange={(event) => { const next = catalog?.exams.find((e) => e.id === event.target.value); if (next) { setExamId(next.id); if (next.papers[0]) openPaper(next.papers[0].id); } }}>{orderedExams.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={14} /></div>
        </div>
        <div className="br-nav-scroll">
          {catalogError ? <div className="br-small-empty"><CircleAlert size={22} /><p>{catalogError}</p><button className="br-text-button" onClick={() => setCatalogAttempt((value) => value + 1)}>다시 시도</button></div> : !catalog ? <div className="br-small-empty"><LoaderCircle className="br-spin" size={22} /><p>목차를 여는 중입니다.</p></div> : !exam ? <div className="br-small-empty"><BookOpen size={25} /><p>등록된 시험 자료가 없습니다.</p></div> : <>
            {paperGroups.map(([subject, papers]) => <div className="br-subject-group" key={subject}><h2>{subject}</h2>{papers.map((item) => <div key={item.id} className="br-paper-group"><button className={`br-paper-button ${paperId === item.id ? "is-active" : ""}`} aria-expanded={paperId === item.id} onClick={() => openPaper(item.id)}><span>{paperId === item.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{item.kind}</span><small>{item.questionCount}</small></button>
              {paperId === item.id && paper && <div className="br-question-toc"><label className="br-toc-search"><Search size={13} /><input aria-label="현재 문서의 문항 찾기" placeholder="문항 번호·제목" value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} />{questionSearch && <button aria-label="문항 검색 지우기" onClick={() => setQuestionSearch("")}><X size={12} /></button>}</label>{paper.questions.filter((q) => `${q.label} ${q.title ?? ""} ${textOnly(q.questionHtml)}`.toLocaleLowerCase().includes(questionSearch.toLocaleLowerCase())).map((q) => <div className="br-toc-question" key={q.id}><button aria-current={activeQuestionId === q.id ? "location" : undefined} className={`br-toc-item ${activeQuestionId === q.id ? "is-active" : ""}`} onClick={() => jumpQuestion(q.id)}><span>{q.label}</span>{reviewMap.get(keyFor(paperId, q.id))?.status === "clear" && reviewMap.get(keyFor(paperId, q.id))?.contentHash === q.contentHash ? <Check size={12} /> : reviewMap.get(keyFor(paperId, q.id))?.status === "error" ? <span className="br-toc-error" aria-label="개인 검증 오류 있음" /> : null}</button>{outline.filter((entry) => entry.questionId === q.id).map((entry) => <button className={`br-toc-part ${entry.sub ? "br-toc-part-sub" : ""} ${activeOutlineId === entry.id ? "is-active" : ""}`} key={entry.id} aria-current={activeOutlineId === entry.id ? "location" : undefined} onClick={() => jumpOutline(entry)}><span />{entry.label}</button>)}</div>)}{questionSearch && !paper.questions.some((q) => `${q.label} ${q.title ?? ""} ${textOnly(q.questionHtml)}`.toLocaleLowerCase().includes(questionSearch.toLocaleLowerCase())) && <p className="br-toc-no-result">일치하는 문항이 없습니다.</p>}</div>}
            </div>)}</div>)}
          </>}
        </div>
        <div className="br-nav-footer"><span><span className="br-live-dot" />나의 속도로, 한 문항씩</span><button onClick={() => { setWidths({ left: 240, right: 340 }); persistLocal(WIDTH_KEY, { left: 240, right: 340 }); }} title="화면 비율 초기화" aria-label="화면 비율 초기화"><RotateCcw size={13} /></button></div>
      </aside>
      <Separator side="left" value={widths.left} onChange={(value) => changeWidth("left", value)} onReset={() => changeWidth("left", 240)} />
      <main className={`br-center ${mobileTab === "reading" ? "br-mobile-active" : ""}`}>
        <div className="br-reading-toolbar"><div className="br-breadcrumb"><span>{exam?.title ?? "문제 자료"}</span><ChevronRight size={12} /><strong>{paperIndex?.title ?? "문서를 선택해 주세요"}</strong></div><div className="br-page-control"><button className="br-icon-button" aria-label="이전 문항" disabled={!paper || activeIndex <= 0} onClick={() => paper && jumpQuestion(paper.questions[activeIndex - 1].id)}><ArrowLeft size={15} /></button><span>{paper?.questions.length ? `${activeIndex + 1} / ${paper.questions.length}` : "—"}</span><button className="br-icon-button" aria-label="다음 문항" disabled={!paper || activeIndex >= paper.questions.length - 1} onClick={() => paper && jumpQuestion(paper.questions[activeIndex + 1].id)}><ArrowRight size={15} /></button></div></div>
        <article className="br-reading" id="br-reading" ref={readingRef} tabIndex={-1} onClick={handleReferenceClick} onMouseUp={captureSelection} onKeyUp={(event) => { if (event.key === "Shift" || event.key.startsWith("Arrow")) captureSelection(); }} aria-label="문제와 해설">
          {paperLoading || (!catalog && !catalogError) ? <div className="br-reading-empty"><div className="br-empty-symbol"><BookOpen size={31} strokeWidth={1} /></div><h2>문제를 펼치고 있습니다.</h2><p>잠시만 기다려 주세요.</p></div> : paperError ? <div className="br-reading-empty"><CircleAlert size={30} /><h2>문제를 열지 못했습니다.</h2><p>{paperError}</p><button className="br-button" onClick={() => setPaperAttempt((value) => value + 1)}>다시 시도</button></div> : paper?.questions.length ? <><div className="br-paper-heading"><p className="br-eyebrow">READ · REASON · REVIEW</p><h1>{exam?.title}</h1><div><span>{paper.subject}</span><i /><span>{paper.kind}</span><i /><span>{paper.questions.length}문항</span></div></div>{paper.questions.map(renderQuestion)}<div className="br-reading-end"><span />이 문서의 마지막 문항입니다.<span /></div></> : <div className="br-reading-empty"><BookOpen size={34} strokeWidth={1} /><h2>읽을 문서를 골라 주세요.</h2><p>왼쪽 목차에서 시험과 과목을 선택할 수 있습니다.</p></div>}
        </article>
      </main>
      <Separator side="right" value={widths.right} onChange={(value) => changeWidth("right", value)} onReset={() => changeWidth("right", 340)} />
      <aside className={`br-right ${mobileTab === "reference" ? "br-mobile-active" : ""}`} id="br-reference-panel" aria-label="참조 근거와 나의 부전지">
        <div className="br-right-tabs" role="tablist" aria-label="참조 자료와 부전지" onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const next = rightTab === "reference" ? "notes" : "reference"; setRightTab(next); document.getElementById(next === "reference" ? "br-reference-tab" : "br-notes-tab")?.focus(); } }}><button role="tab" aria-selected={rightTab === "reference"} id="br-reference-tab" aria-controls="br-reference-content" className={rightTab === "reference" ? "is-active" : ""} onClick={() => setRightTab("reference")}><Scale size={15} />참조 근거</button><button role="tab" aria-selected={rightTab === "notes"} id="br-notes-tab" aria-controls="br-notes-content" className={rightTab === "notes" ? "is-active" : ""} onClick={() => setRightTab("notes")}><StickyNote size={15} />부전지{currentNotes.length > 0 && <span>{currentNotes.length}</span>}</button></div>
        <div className="br-right-scroll">
          {rightTab === "reference" ? <div role="tabpanel" id="br-reference-content" aria-labelledby="br-reference-tab">
            <div className="br-right-context"><span>{currentQuestion?.label ?? "참조 자료"}</span><small>{relevantReferences.length}개의 연결 근거</small></div>
            {relevantReferences.length > 0 && <div className="br-reference-list">{relevantReferences.map((ref) => <button key={ref.id} aria-pressed={activeReference?.id === ref.id} className={activeReference?.id === ref.id ? "is-active" : ""} onClick={() => selectReference(ref.id)}><span className={`br-reference-kind br-reference-kind-${ref.kind}`}>{referenceNames[ref.kind]}</span><span>{ref.title}</span><ChevronRight size={12} /></button>)}</div>}
            {activeReference ? <section className="br-reference-detail" key={activeReference.id}><div className="br-reference-detail-kicker"><span className={`br-reference-kind br-reference-kind-${activeReference.kind}`}>{referenceNames[activeReference.kind]}</span>{activeReference.status && <span>{activeReference.status}</span>}</div><h2>{activeReference.title}</h2><div className="br-prose br-reference-prose" onClick={handleReferenceClick} dangerouslySetInnerHTML={{ __html: referenceDisplayHtml(activeReference.html || "<p>본문을 확인할 자료가 없습니다.</p>") }} />{activeReference.url && <a className="br-official-link" href={activeReference.url} target="_blank" rel="noreferrer">공식 원문 보기<ArrowUpRight size={14} /></a>}</section>
              : <div className="br-reference-empty"><Scale size={32} strokeWidth={1} /><h2>판단의 근거를 곁에.</h2><p>본문의 조문이나 판례를 누르면<br />이곳에서 이어 읽을 수 있습니다.</p><span>조문 · 판례 · 공식 원문</span></div>}
          </div> : <div role="tabpanel" id="br-notes-content" aria-labelledby="br-notes-tab"><div className="br-right-context"><span>{editor ? "메모 작성" : currentQuestion?.label ?? "나의 메모"}</span><button className="br-text-button" disabled={!currentQuestion} onClick={() => currentQuestion && startNote(currentQuestion)}><Plus size={13} />새 메모</button></div>
            {editor && <section className={`br-note-editor br-note-${editor.color ?? "yellow"}`}><div className="br-editor-heading"><span>{editor.anchorText ? "선택한 글에 부전지" : editor.atomId ? "atom 메모" : "문항 메모"}</span><button className="br-icon-button" aria-label="메모 작성 닫기. 초안은 보존됩니다." onClick={() => setEditor(null)}><X size={15} /></button></div><p className="br-editor-context">{questionName(editor)}</p>{editor.anchorText && <blockquote>{editor.anchorText}</blockquote>}{editor.paperId === paperId && paper?.questions.find((q) => q.id === editor.questionId)?.contentHash !== editor.contentHash && <div className="br-form-error"><p>이 메모를 작성한 뒤 본문이 변경되었습니다. 인용 위치와 내용을 다시 확인해 주세요.</p><button className="br-text-button" disabled={noteSourceChecking || noteSaving} onClick={() => void prepareNoteReconnect()}>{noteSourceChecking ? "최신 본문 확인 중…" : "최신 본문 확인"}</button></div>}<label className="br-sr-only" htmlFor="br-note-body">메모 내용</label><textarea ref={editorRef} disabled={noteSaving} id="br-note-body" placeholder="떠오른 생각, 더 확인할 것을 적어 보세요." value={editor.body} rows={7} onChange={(event) => updateEditor({ body: event.target.value })} />
              <div className="br-editor-color-row"><div aria-label="부전지 색상" className="br-note-colors">{NOTE_COLORS.map((color, index) => <button disabled={noteSaving} aria-label={`${["노랑", "민트", "분홍", "파랑"][index]} 부전지`} aria-pressed={editor.color === color} className={`br-color-${color}`} key={color} onClick={() => updateEditor({ color })}>{editor.color === color && <Check size={12} />}</button>)}</div><span>초안 보관</span></div>
              {editor.error && <div className="br-form-error" role="alert"><p>{editor.error}</p><button className="br-text-button" disabled={noteSourceChecking || noteSaving} onClick={() => void prepareNoteReconnect()}>{noteSourceChecking ? "최신 본문 확인 중…" : "최신 문제 다시 불러오기"}</button>{editor.conflict && <><p className="br-conflict-current">저장된 메모: {editor.conflict.body}</p><button className="br-text-button" onClick={() => updateEditor({ revision: editor.conflict!.revision, conflict: undefined })}>위 내용을 확인했습니다. 내 메모로 다시 저장</button></>}{!initialUser && <a href={RECONNECT} target="_top">다시 연결하기 <ArrowUpRight size={12} /></a>}</div>}
              {noteReconnect?.id === editor.id && <div className="br-form-error" role="status"><p>최신 본문을 확인한 뒤 다시 연결해 주세요. 메모와 원래 인용문은 그대로 유지됩니다.</p><div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:12}}><button className="br-button br-button-primary" style={{minHeight:44}} disabled={noteSaving || paperLoading || paper?.id !== editor.paperId || paper.questions.find(item => item.id === editor.questionId)?.contentHash !== noteReconnect.contentHash} onClick={confirmNoteReconnect}>이 본문에 다시 연결하고 저장</button><button className="br-button" style={{minHeight:44}} onClick={() => setNoteReconnect(null)}>다시 연결 취소</button></div></div>}
              <button className="br-button br-button-primary br-full-width" onClick={() => void saveNote()} disabled={noteSaving || noteSourceChecking || !!noteReconnect}>{noteSaving ? <LoaderCircle size={14} className="br-spin" /> : <Check size={14} />}메모 저장</button></section>}
            {currentNotes.filter((note) => note.id !== editor?.id).map((note) => renderNote(note))}
            {!currentNotes.length && !editor && <div className="br-reference-empty br-notes-empty"><PenLine size={30} strokeWidth={1} /><h2>생각을 남기는 자리.</h2><p>본문에서 글을 선택해 부전지를 붙이거나,<br />이 문항에 자유롭게 메모해 보세요.</p><button className="br-button" disabled={!currentQuestion} onClick={() => currentQuestion && startNote(currentQuestion)}><Plus size={14} />첫 메모 남기기</button></div>}
            <button className="br-all-notes-link" onClick={(event) => { lastRecordTrigger.current = event.currentTarget; setAllRecordsOpen(true); }}>전체 기록 모아보기<ArrowUpRight size={13} /></button>
          </div>}
        </div><div className="br-right-footer"><BookOpen size={12} />근거를 읽고, 나의 판단을 기록하세요.</div>
      </aside>
    </div>
    {selection && <div className="br-selection-action" style={{ top: selection.top, left: selection.left }}><button aria-keyshortcuts="Alt+N" title="선택한 글에 부전지 · Alt+N" onMouseDown={(event) => event.preventDefault()} onClick={() => { const question = paper?.questions.find((q) => q.id === selection.questionId); if (question) startNote(question, selection.atomId, selection); }}><StickyNote size={15} />선택한 글에 부전지</button><button aria-label="텍스트 선택 메뉴 닫기" onClick={() => setSelection(null)}><X size={13} /></button></div>}
    <div className="br-toast" role="status" aria-live="polite">{notice && <><CheckCircle2 size={15} /><span>{notice}</span><button aria-label="안내 닫기" onClick={() => setNotice("")}><X size={13} /></button></>}</div>
    <dialog className="br-records-dialog" ref={dialogRef} aria-labelledby="br-records-title" onCancel={() => setAllRecordsOpen(false)} onClose={() => { setAllRecordsOpen(false); if (editor) window.requestAnimationFrame(() => editorRef.current?.focus()); else lastRecordTrigger.current?.focus(); }}>
      <div className="br-records-heading"><div><p className="br-eyebrow">MY READING NOTES</p><h2 id="br-records-title">나의 기록</h2></div><div>{initialUser && <ImportRecordsButton userId={initialUser.id}
        serverNotes={recordsReady && !recordsError ? notes : undefined} serverReviews={recordsReady && !recordsError ? reviews : undefined}
        getServerRecords={loadRecords} resolveTarget={catalog ? resolveImportedTarget : undefined} onImported={(drafts) => {
          setNoteDrafts(drafts.notes); setReviewDrafts(drafts.reviews); setStorageError(false); setMarkdownPreview(null); refreshRecordMetadata(value => value + 1);
        }} />}<RecordHistory /><button className="br-button" disabled={exportBusy} onClick={() => void exportRecords()}><ArrowDownToLine size={14} />{exportBusy ? "전체 기록 확인 중…" : "전체 기록 내보내기"}</button><button className="br-icon-button" aria-label="기록 모아보기 닫기" onClick={() => setAllRecordsOpen(false)}><X size={20} /></button></div></div>
      {exportError && <p className="br-form-error" role="alert" style={{margin:"12px 24px"}}>{exportError}</p>}
      <div className="br-record-controls"><div className="br-record-switch"><button className={recordTab === "notes" ? "is-active" : ""} onClick={() => { setRecordTab("notes"); setMarkdownPreview(null); }}>부전지 <b>{combinedNotes.length}</b></button><button className={recordTab === "reviews" ? "is-active" : ""} onClick={() => setRecordTab("reviews")}>개인 검증 <b>{combinedReviews.length}</b></button></div><div className="br-md-actions"><button disabled={markdownBusy} onClick={() => void openNotesMarkdown(false)}><FileText size={13} />MD 보기</button><button disabled={markdownBusy} onClick={() => void openNotesMarkdown(true)}>{markdownBusy ? <LoaderCircle size={13} className="br-spin" /> : <ArrowDownToLine size={13} />}부전지 전체 MD</button></div><label className="br-record-search"><Search size={15} /><input aria-label="전체 기록 검색" placeholder="메모 또는 문항 검색" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} /></label><label className="br-record-filter"><input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />{recordTab === "notes" ? "미해결만" : "오류 있음만"}</label></div>
      <div className="br-records-content">{markdownPreview !== null && recordTab === "notes" ? <div className="br-markdown-view"><div><span>전체 부전지 · Markdown</span><button onClick={() => void openNotesMarkdown(false)} disabled={markdownBusy}><RotateCcw size={12} />새로고침</button><button onClick={() => setMarkdownPreview(null)}>카드로 보기</button></div><pre tabIndex={0} aria-label="전체 부전지 Markdown">{markdownPreview}</pre></div> : <><p className="br-record-result-count">{recordTab === "notes" ? filteredNotes.length : filteredReviews.length}개 표시</p>{recordTab === "notes" ? filteredNotes.length ? <div className="br-note-grid">{filteredNotes.map((note) => renderNote(note, true))}</div> : <div className="br-records-empty"><StickyNote size={32} strokeWidth={1} /><h3>{recordSearch || unresolvedOnly ? "조건에 맞는 메모가 없습니다." : "아직 남긴 메모가 없습니다."}</h3><p>문제를 읽다가 기억할 글에 부전지를 붙여 보세요.</p></div> : filteredReviews.length ? <div className="br-review-records">{filteredReviews.map((review) => <article key={keyFor(review.paperId, review.questionId, review.atomId)}><div>{review.localOnly ? <span className="br-status br-status-unreviewed">저장 전 초안 · {reviewNames[review.status]}</span> : <StatusBadge review={review} hash={paperCache.current.get(review.paperId)?.questions.find((q) => q.id === review.questionId)?.contentHash} />}<time>{dateLabel(review.updatedAt)}</time></div><button onClick={() => goToReview(review)}>{questionName(review)}<ArrowUpRight size={13} /></button>{review.atomId && reviewAtomStatement(review) && <blockquote className="br-review-atom-quote">{reviewAtomStatement(review)}</blockquote>}{review.detail && <p>{review.detail}</p>}</article>)}</div> : <div className="br-records-empty"><CheckCircle2 size={31} strokeWidth={1} /><h3>개인 검증 기록이 없습니다.</h3><p>각 문항 아래에서 검토 결과를 남길 수 있습니다.</p></div>}</>}</div>
      <footer>개인 검증 기록은 공식 정답 확정 여부와 별개입니다.{!initialUser && <a href={RECONNECT} target="_top">다시 연결하고 기록 저장하기<ArrowUpRight size={12} /></a>}</footer>
    </dialog>
  </div>;
}
