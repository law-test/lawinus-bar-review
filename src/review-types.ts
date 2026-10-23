export type ReviewUser = { id: string; name: string; email: string };
export type PaperIndex = {
  id: string;
  title: string;
  subject: string;
  kind: string;
  questionCount: number;
  dataUrl: string;
};
export type ExamIndex = {
  id: string;
  family: "bar" | "mock";
  title: string;
  year: number;
  round: number | string;
  papers: PaperIndex[];
};
export type ReviewCatalog = {
  version: string | number;
  title: string;
  exams: ExamIndex[];
};
export type ReviewReference = {
  id: string;
  kind: "law" | "case" | "source" | "unresolved";
  title: string;
  html: string;
  url?: string;
  status?: string;
};
export type ReviewAtom = {
  id: string;
  label: string;
  statement: string;
  answer?: string;
  explanationHtml?: string;
  referenceIds: string[];
  status?: string;
  retired?: boolean;
  splitChildIds?: string[];
  parentId?: string;
};
export type ReviewQuestion = {
  id: string;
  number: number | string;
  label: string;
  title?: string;
  questionHtml: string;
  explanationHtml: string;
  atoms: ReviewAtom[];
  referenceIds: string[];
  source: { label: string; url: string }[];
  availability: "available" | "missing";
  contentHash: string;
};
export type ReviewPaper = {
  id: string;
  title: string;
  subject: string;
  kind: string;
  questions: ReviewQuestion[];
  references: ReviewReference[];
};
export type AnchorMeta = {
  section: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
};
export type PersonalNote = {
  id: string;
  paperId: string;
  questionId: string;
  atomId?: string;
  anchorText?: string;
  anchorMeta?: AnchorMeta;
  body: string;
  color?: string;
  resolved?: boolean;
  contentHash: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  localOnly?: boolean;
};
export type PersonalReview = {
  id?: string;
  paperId: string;
  questionId: string;
  atomId?: string;
  status: "clear" | "error" | "unreviewed";
  detail: string;
  contentHash: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  localOnly?: boolean;
};
export type ReviewDraft = {
  paperId: string;
  questionId: string;
  atomId?: string;
  status: PersonalReview["status"];
  detail: string;
  contentHash: string;
  expectedRevision?: number;
};
export type NoteEditor = PersonalNote & { error?: string; conflict?: PersonalNote };
export type SelectionAnchor = {
  questionId: string;
  atomId?: string;
  text: string;
  meta: AnchorMeta;
  top: number;
  left: number;
};
