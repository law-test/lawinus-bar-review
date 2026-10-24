import type { ReviewReference } from './review-types';

export type CitationRequest = { query: string; kind: 'law' | 'case'; candidateIds: string[] };
export type CitationMatch = CitationRequest & { start: number; end: number };
type LawCitation = { name: string; article: string; paragraph: string; item: string };
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compact = (value: string) => value.replace(/\s+/g, '');
const casePattern = /(?<![\d가-힣])\d{2,4}(?:재헌마|재헌바|헌가|헌나|헌다|헌라|헌마|헌바|헌사|헌아|재다|재도|재두|고합|고단|구합|구단|가합|가단|다|도|두|누|나|마|무|모|므|스|추|부)\d+(?!\d)/g;
const articleTail = '(?:제\\s*)?(\\d+)\\s*조(?:\\s*의\\s*(\\d+))?(?:\\s*제?\\s*(\\d+)\\s*항)?(?:\\s*제?\\s*(\\d+)\\s*호)?';
const genericLaw = /(?<![가-힣\w])(?:대한민국헌법|헌법|[가-힣ㆍ·]+(?:법률|법))\s*(?:제\s*)?\d+\s*조(?:\s*의\s*\d+)?(?:\s*제?\s*\d+\s*항)?(?:\s*제?\s*\d+\s*호)?/g;
const shortLaw = /(?<![가-힣\w])(?:대한민국헌법|헌법|[가-힣ㆍ·]+(?:법률|법))\s*\d+(?:[①②③④⑤⑥⑦⑧⑨⑩]\d*)/g;

function lawCitation(value: string): LawCitation | null {
  const clean = value.replace(/^[「『\s]+|[」』]/g, '').replace(/\s+\d{8}(?=\s*제)/, ' ');
  const match = clean.match(new RegExp('^(.+?)\\s+' + articleTail));
  if (!match) return null;
  return { name: compact(match[1]), article: match[2] + (match[3] ? '의' + match[3] : ''), paragraph: match[4] ?? '', item: match[5] ?? '' };
}

function queryLaw(value: string, references: ReviewReference[]): LawCitation | null {
  // Normalize only explicit compact notation; never infer a law name or article.
  value = value.replace(/(\d+)([①②③④⑤⑥⑦⑧⑨⑩])(\d*)$/, (_all, article, paragraph, item) =>
    ` 제${article}조 제${'①②③④⑤⑥⑦⑧⑨⑩'.indexOf(paragraph) + 1}항${item ? ` 제${item}호` : ''}`).trim();
  for (const reference of references) {
    if (reference.kind !== 'law') continue;
    const law = lawCitation(reference.title);
    if (!law) continue;
    // Only the actual title is an alias. Short names are never expanded by guesswork.
    const prefix = reference.title.match(/^(.+?)\s+(?:\d{8}\s+)?제\s*\d/)?.[1];
    if (!prefix) continue;
    const match = value.match(new RegExp('^' + escapePattern(prefix).replace(/\s+/g, '\\s*') + '\\s*' + articleTail + '$'));
    if (match) return { name: law.name, article: match[1] + (match[2] ? '의' + match[2] : ''), paragraph: match[3] ?? '', item: match[4] ?? '' };
  }
  return lawCitation(value.replace(/(?<=[가-힣])(?=제?\d)/, ' '));
}

export function citationCandidates(query: string, kind: 'law' | 'case', references: ReviewReference[], preferredIds: readonly string[] = []): string[] {
  const parsed = kind === 'law' ? queryLaw(query, references) : null;
  const candidates = references.filter(reference => {
    if (reference.kind !== kind) return false;
    if (kind === 'case') return [...reference.title.matchAll(new RegExp(casePattern.source, 'g'))].some(match => match[0] === query);
    const law = lawCitation(reference.title);
    return !!parsed && !!law && law.name === parsed.name && law.article === parsed.article &&
      (!law.paragraph || law.paragraph === parsed.paragraph) && (!law.item || law.item === parsed.item);
  }).map(reference => reference.id);
  const local = candidates.filter(id => preferredIds.includes(id));
  return [...new Set(local.length ? local : candidates)];
}

export function findCitations(text: string, references: ReviewReference[], preferredIds: readonly string[] = []): CitationMatch[] {
  const spans: { query: string; kind: 'law' | 'case'; start: number; end: number }[] = [];
  const add = (pattern: RegExp, kind: 'law' | 'case') => {
    for (const match of text.matchAll(pattern)) spans.push({ query: match[0], kind, start: match.index!, end: match.index! + match[0].length });
  };
  add(new RegExp(casePattern.source, 'g'), 'case');
  add(new RegExp(genericLaw.source, 'g'), 'law');
  add(new RegExp(shortLaw.source, 'g'), 'law');
  const names = [...new Set(references.filter(reference => reference.kind === 'law').map(reference =>
    reference.title.match(/^(.+?)\s+(?:\d{8}\s+)?제\s*\d/)?.[1]).filter((value): value is string => !!value))];
  for (const name of names) add(new RegExp('(?<![가-힣\\w])' + escapePattern(name).replace(/\s+/g, '\\s*') + '\\s*' + articleTail, 'g'), 'law');
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: CitationMatch[] = [];
  for (const span of spans) {
    if (result.length && span.start < result[result.length - 1].end) continue;
    result.push({ ...span, candidateIds: citationCandidates(span.query, span.kind, references, preferredIds) });
  }
  return result;
}

/** Add display controls only. Every original text code unit is retained for saved note anchors. */
export function decorateReferenceNodes(root: HTMLElement, references: ReviewReference[], preferredIds: readonly string[] = []): number {
  const original = root.textContent;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a,button,code,pre,script,style,textarea,input,select,[contenteditable],[data-reference-id],[data-citation-query]')) nodes.push(node);
  }
  let count = 0;
  for (const node of nodes) {
    const text = node.data, matches = findCitations(text, references, preferredIds);
    if (!matches.length) continue;
    const fragment = root.ownerDocument.createDocumentFragment(); let offset = 0;
    for (const match of matches) {
      fragment.append(root.ownerDocument.createTextNode(text.slice(offset, match.start)));
      const button = root.ownerDocument.createElement('button');
      button.type = 'button'; button.className = 'br-citation-link';
      button.dataset.citationQuery = match.query; button.dataset.citationKind = match.kind;
      button.dataset.referenceCandidates = JSON.stringify(match.candidateIds);
      button.setAttribute('aria-label', match.query + ' 근거 보기');
      button.textContent = text.slice(match.start, match.end);
      fragment.append(button); offset = match.end; count++;
    }
    fragment.append(root.ownerDocument.createTextNode(text.slice(offset))); node.replaceWith(fragment);
  }
  if (root.textContent !== original) throw Error('Citation decoration changed a note anchor text');
  return count;
}

export function referenceIdsForUrl(href: string, references: ReviewReference[]): string[] {
  let parsed: URL;
  try { parsed = new URL(href); } catch { return []; }
  if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)(law\.go\.kr|scourt\.go\.kr|ccourt\.go\.kr)$/.test(parsed.hostname)) return [];
  parsed.hash = '';
  return references.filter(reference => {
    if (!reference.url) return false;
    try { const candidate = new URL(reference.url); candidate.hash = ''; return candidate.href === parsed.href; } catch { return false; }
  }).map(reference => reference.id);
}

export function officialSearchUrl(query: string): string {
  return 'https://www.law.go.kr/LSW/unSc.do?query=' + encodeURIComponent(query);
}
