import {useEffect, useState, type ReactNode} from 'react';
import {supabase} from './backend';

const pendingKey='lawinus-bar-record-transfer-v1';
export function takeRecordTransfer(): string | null {
  const params=new URLSearchParams(window.location.hash.slice(1));
  const received=params.get('restore');
  if(received!==null){
    params.delete('restore');
    const rest=params.toString();
    history.replaceState(null,'',location.pathname+location.search+(rest?'#'+rest:''));
    if(/^[a-f0-9]{64}$/.test(received)){
      try{sessionStorage.setItem(pendingKey,received);}catch{/* The in-memory copy remains usable. */}
      return received;
    }
    return null;
  }
  try{const stored=sessionStorage.getItem(pendingKey);return stored&&/^[a-f0-9]{64}$/.test(stored)?stored:null;}catch{return null;}
}

export function RecordTransfer({token,userId,children}:{token:string|null;userId:string;children:ReactNode}){
  const [state,setState]=useState<'pending'|'linked'|'failed'|'done'>(token?'pending':'done');
  const [retry,setRetry]=useState(0);
  const [message,setMessage]=useState('');
  const [counts,setCounts]=useState({notes:0,history:0});
  useEffect(()=>{
    if(!token)return;
    let active=true;
    setState('pending');
    const request=Promise.resolve().then(async()=>{
      if(!active)return {data:null,error:null};
      return await supabase.rpc('bar_review_claim_records',{token});
    });
    void request.then(({data,error})=>{
      if(!active)return;
      if(error||data?.status!==200){
        const reason=data?.data?.error;
        setMessage(reason==='transfer_already_used'?'이 링크는 다른 브라우저에서 이미 사용했습니다. 연결한 브라우저에서 열어 주세요.':reason==='transfer_expired'?'연결 링크의 유효기간이 지났습니다. 새 연결 링크가 필요합니다.':'기록을 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
        setState('failed');return;
      }
      setCounts({notes:Number(data.data.notes),history:Number(data.data.history)});
      try{sessionStorage.removeItem(pendingKey);}catch{/* Already linked on the server. */}
      setState('linked');
    }).catch(()=>{if(active){setMessage('연결 상태를 확인한 뒤 다시 시도해 주세요. 기존 기록은 유지됩니다.');setState('failed');}});
    return()=>{active=false;};
  },[token,userId,retry]);
  if(state==='done')return <>{children}</>;
  return <main className="auth-shell"><section className="auth-card">
    <p className="auth-eyebrow">LAW IN US</p>
    <h1>{state==='linked'?'기존 기록을 연결했습니다.':state==='pending'?'기존 기록을 연결하는 중…':'기록 연결을 확인해 주세요.'}</h1>
    {state==='linked'?<><p role="status">메모 {counts.notes}개와 변경 이력 {counts.history}건을 이 브라우저에서 확인할 수 있습니다.</p><button onClick={()=>{try{sessionStorage.setItem('lawinus-bar-open-records','1');}catch{/* The records button remains available. */}setState('done');}}>나의 기록 보기</button></>:state==='failed'?<><p role="alert">{message}</p><button onClick={()=>setRetry(x=>x+1)}>다시 시도</button><button onClick={()=>{try{sessionStorage.removeItem(pendingKey);}catch{}setState('done');}}>검토실 열기</button></>:<p role="status">잠시만 기다려 주세요.</p>}
  </section></main>;
}
