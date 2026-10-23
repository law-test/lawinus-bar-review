import {useEffect,useRef,useState} from 'react';
import {supabase} from './backend';
type Entry={id:string;recordId?:string;record_id?:string;kind:string;action:string;payload:string|Record<string,unknown>;createdAt?:string;created_at?:string};
const labels:Record<string,string>={create:'작성',update:'수정',delete:'삭제'};
function text(value:unknown):string{return typeof value==='string'?value:'';}
function content(row:Entry){
  let value:Record<string,unknown>={};
  try{value=typeof row.payload==='string'?JSON.parse(row.payload):row.payload;}catch{return {body:'',question:''};}
  if(!value||typeof value!=='object'||Array.isArray(value))return {body:'',question:''};
  return {body:text(value.body)||text(value.detail),question:text(value.questionId)||text(value.question_id)};
}
export default function RecordHistory(){
  const ref=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false),[entries,setEntries]=useState<Entry[]>([]),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  const requestedOffset=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>{if(open)ref.current?.showModal();else ref.current?.close();},[open]);
  async function load(offset=0){
    requestedOffset.current=offset;
    const run=++generation.current;setBusy(true);setError('');
    try{
      const {data,error:failure}=await supabase.rpc('bar_review_record_history',{page_offset:offset});
      if(run!==generation.current)return;
      if(failure||data?.status!==200||!Array.isArray(data.data?.history))throw Error();
      setEntries(old=>offset===0?data.data.history:[...old,...data.data.history]);setMore(data.data.hasMore===true);
    }catch{if(run===generation.current)setError('변경 이력을 불러오지 못했습니다. 다시 시도해 주세요.');}
    finally{if(run===generation.current)setBusy(false);}
  }
  return <><button className="br-button" type="button" onClick={()=>{setOpen(true);void load();}}>변경 이력</button>
    <dialog ref={ref} className="br-records-dialog br-history-dialog" aria-labelledby="br-history-title" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}>
      <div className="br-records-heading"><div><p className="br-eyebrow">MY RECORDS</p><h2 id="br-history-title">변경 이력</h2></div><button className="br-button" onClick={()=>setOpen(false)}>닫기</button></div>
      <div className="br-history-list" style={{padding:'24px',overflowY:'auto',maxHeight:'65vh'}}>
        {entries.map(row=>{const value=content(row);const date=row.createdAt??row.created_at??'';return <article key={row.id} className="br-note-card" style={{marginBottom:'16px'}}><div><strong>{row.kind==='note'?'부전지':'검증'} {labels[row.action]??row.action}</strong><time style={{float:'right'}} dateTime={date}>{date?new Date(date).toLocaleString('ko-KR'):''}</time></div>{value.question&&<p>{value.question}</p>}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{value.body||'기록 내용 변경'}</p></article>;})}
        {busy&&<p role="status">이력을 불러오는 중…</p>}
        {error&&<p role="alert">{error} <button className="br-button" onClick={()=>void load(requestedOffset.current)}>다시 시도</button></p>}
        {!busy&&!error&&entries.length===0&&<p>아직 변경 이력이 없습니다.</p>}
        {more&&!busy&&<button className="br-button" onClick={()=>void load(entries.length)}>이력 더 보기</button>}
      </div>
    </dialog></>;
}
