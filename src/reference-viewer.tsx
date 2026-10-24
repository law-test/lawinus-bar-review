import type { MouseEvent } from 'react';
import { ArrowUpRight, Maximize2, Scale } from 'lucide-react';
import type { ReviewReference } from './review-types';
import type { CitationRequest } from './reference-links';
import { officialSearchUrl } from './reference-links';

const names = { law: '조문', case: '판례', source: '자료', unresolved: '확인 필요' };
type Props = {
  reference?: ReviewReference;
  request: CitationRequest | null;
  references: ReviewReference[];
  onSelect: (id: string) => void;
  onExpand?: () => void;
  onReferenceClick: (event: MouseEvent<HTMLElement>) => void;
  displayHtml?: (html: string) => string;
};

export function ReferenceViewer({ reference, request, references, onSelect, onExpand, onReferenceClick, displayHtml = value => value }: Props) {
  if (request) {
    const choices = request.candidateIds.map(id => references.find(reference => reference.id === id)).filter((value): value is ReviewReference => !!value);
    return <section className="br-reference-detail br-reference-choice">
      <div className="br-reference-title-row"><h2>{request.query}</h2>{onExpand && <button className="br-reference-expand" onClick={onExpand}><Maximize2 size={16} />크게 보기</button>}</div>
      <p>{choices.length ? '연결할 근거를 선택해 주세요. 제목에 표시된 판본과 시행일을 확인할 수 있습니다.' : '연결된 근거가 없습니다.'}</p>
      {choices.length > 0 && <div className="br-reference-choices">{choices.map(choice => <button key={choice.id} onClick={() => onSelect(choice.id)}><span>{names[choice.kind]}</span><strong>{choice.title}</strong>{choice.status && <small>{choice.status}</small>}</button>)}</div>}
      <a className="br-official-link" href={officialSearchUrl(request.query)} target="_blank" rel="noreferrer">국가법령정보센터에서 이 인용 검색<ArrowUpRight size={14} /></a>
    </section>;
  }
  if (!reference) return <div className="br-reference-empty"><Scale size={32} strokeWidth={1} /><h2>판단의 근거를 곁에.</h2><p>본문의 조문이나 판례를 누르면<br />이곳에서 이어 읽을 수 있습니다.</p><span>조문 · 판례 · 공식 원문</span></div>;
  const external = reference.url && /^https?:\/\//i.test(reference.url) ? reference.url : undefined;
  return <section className="br-reference-detail" key={reference.id}>
    <div className="br-reference-detail-kicker"><span className={`br-reference-kind br-reference-kind-${reference.kind}`}>{names[reference.kind]}</span>{reference.status && <span>{reference.status}</span>}</div>
    <div className="br-reference-title-row"><h2>{reference.title}</h2>{onExpand && <button className="br-reference-expand" onClick={onExpand}><Maximize2 size={16} />크게 보기</button>}</div>
    <div className="br-prose br-reference-prose" onClick={onReferenceClick} dangerouslySetInnerHTML={{ __html: displayHtml(reference.html || '<p>본문을 확인할 자료가 없습니다.</p>') }} />
    {external && <a className="br-official-link" href={external} target="_blank" rel="noreferrer">공식 원문 보기<ArrowUpRight size={14} /></a>}
  </section>;
}
