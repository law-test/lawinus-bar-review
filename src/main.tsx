import {useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {User} from '@supabase/supabase-js';
import {supabase,clearMaterialUrls,setMaterialUser} from './backend';
import ReviewWorkspace from './review-workspace';
import './login.css';

function App(){
 const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[allowed,setAllowed]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [mode,setMode]=useState<'login'|'signup'|'verify'>('login'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const authGeneration=useRef(0),verifiedIdentity=useRef<string|null>(null);
 const reviewUser=useMemo(()=>user?{id:user.id,name:user.email?.split('@')[0]??'내 계정',email:user.email??''}:null,[user?.id,user?.email]);
 useEffect(()=>{let alive=true;
  async function check(){
   const generation=++authGeneration.current;
   if(!verifiedIdentity.current)setReady(false);
   const current=()=>alive&&generation===authGeneration.current;
   try{
    const {data:{user:nextUser},error}=await supabase.auth.getUser();
    if(!current())return;
    if(error||!nextUser||nextUser.is_anonymous){
     verifiedIdentity.current=null;clearMaterialUrls();setUser(null);setAllowed(false);setReady(true);return;
    }
    const result=await supabase.rpc('bar_review_claim_membership');
    if(!current())return;
    const nextAllowed=!result.error&&result.data?.status===200;
    verifiedIdentity.current=nextUser.id;
    if(nextAllowed)setMaterialUser(nextUser.id);else clearMaterialUrls();
    setUser(nextUser);setAllowed(nextAllowed);setReady(true);
   }catch{
    if(!current())return;
    verifiedIdentity.current=null;clearMaterialUrls();setUser(null);setAllowed(false);setReady(true);
    setMessage('로그인을 확인하지 못했습니다. 다시 로그인해 주세요.');
   }
  }
  void check();const {data}=supabase.auth.onAuthStateChange((_event,session)=>{
   authGeneration.current++;
   if(!session||session.user.id!==verifiedIdentity.current){
    verifiedIdentity.current=null;clearMaterialUrls();setUser(null);setAllowed(false);setReady(!session);
   }
   if(session)setTimeout(()=>{if(alive)void check();},0);
  });
  return()=>{alive=false;authGeneration.current++;data.subscription.unsubscribe();clearMaterialUrls();};
 },[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');
  try{
   if(mode==='signup'){
    const {data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:'https://test.lawinus.org/'}});if(error)throw error;
    if(!data.session){setMode('verify');setMessage('인증 메일의 링크를 누른 뒤, 이 화면으로 돌아와 로그인해 주세요.');}
   }else{const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
  }catch{setMessage(mode==='login'?'로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.':'인증을 완료하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.');}
  finally{setBusy(false);}
 }
 async function logout(){
  authGeneration.current++;verifiedIdentity.current=null;clearMaterialUrls();setAllowed(false);setUser(null);setReady(true);setPassword('');
  const {error}=await supabase.auth.signOut({scope:'local'});
  if(error)setMessage('로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.');
 }
 if(!ready)return <div className="auth-shell"><p>로그인 확인 중…</p></div>;
 if(user&&allowed&&reviewUser)return <><ReviewWorkspace key={user.id} initialUser={reviewUser}/><button className="auth-logout" onClick={()=>void logout()}>로그아웃</button></>;
 return <main className="auth-shell"><form onSubmit={submit} className="auth-card"><p className="auth-eyebrow">LAW IN US</p><h1>변호사시험 검토실</h1><p>문제와 해설을 읽고, 검증 기록과 부전지를 남기세요.</p>
  {user?<><p role="alert">이 계정에는 검토실 이용 권한이 없습니다. 허용된 이메일 계정으로 로그인해 주세요.</p><button type="button" onClick={()=>void logout()}>다른 계정으로 로그인</button></>:<>
   <label>이메일<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
   <label>비밀번호<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>
   <button disabled={busy}>{busy?'확인 중…':mode==='signup'?'계정 만들기':mode==='verify'?'인증 후 로그인':'로그인'}</button>
   <button className="auth-link" type="button" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('');}}>{mode==='login'?'처음 이용하나요? 계정 만들기':'로그인으로 돌아가기'}</button>
  </>}{message&&<p role="status">{message}</p>}
 </form></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
