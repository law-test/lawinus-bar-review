import {createClient} from '@supabase/supabase-js';
import {MaterialUrlCache} from './material-cache';
export const supabase=createClient('https://cefaekvclooytgjkcqum.supabase.co','sb_publishable_rDQaJn7uOU80zhvd9mqBsA_blZiSivL',{
  auth:{storageKey:'lawinus-bar-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
});
const bucket='bar-review-materials';
const catalogPath='/data/catalog-v010-3f357e1df735.json';
const urls=new MaterialUrlCache(async key=>{
  const {data,error}=await supabase.storage.from(bucket).createSignedUrl(key,3600);
  if(error||!data)throw Error('자료에 접근할 수 없습니다. 연결 상태를 확인해 주세요.');
  return data.signedUrl;
});
export function clearMaterialUrls(){urls.clear();}
export function setMaterialUser(userId:string){urls.setOwner(userId);}
export function privateUrl(path:string):Promise<string>{return urls.get(path);}
export async function hydrateMaterialLinks<T>(value:T):Promise<T>{
  const raw=JSON.stringify(value),matches=new Set(raw.match(/\/sources\/[^\s"<>\\]+/g)??[]);
  const replacements=await Promise.all([...matches].map(async path=>[path,await privateUrl(path)] as const));
  let output=raw;
  for(const [path,url]of replacements.sort((a,b)=>b[0].length-a[0].length))output=output.split(path).join(url);
  return JSON.parse(output) as T;
}
export async function appFetch(url:string,init:RequestInit={}):Promise<Response>{
  if(url==='/data/catalog.json')url=catalogPath;
  if(url.startsWith('/data/')||url.startsWith('/sources/'))return fetch(await privateUrl(url),init);
  if(!url.startsWith('/api/'))throw Error('Unexpected request');
  const method=init.method??'GET';
  const parsed=new URL(url,location.origin);
  const body=typeof init.body==='string'?JSON.parse(init.body):{};
  let rpc='',args:Record<string,unknown>={};
  if(parsed.pathname==='/api/records'&&method==='GET')rpc='bar_review_records';
  else if(parsed.pathname==='/api/notes'&&method==='PUT'){rpc='bar_review_note_put';args={body};}
  else if(parsed.pathname==='/api/notes'&&method==='DELETE'){rpc='bar_review_note_delete';args={id:parsed.searchParams.get('id'),expected_revision:Number(parsed.searchParams.get('expectedRevision'))};}
  else if(parsed.pathname==='/api/reviews'&&method==='PUT'){rpc='bar_review_review_put';args={body};}
  else return Response.json({error:'not_found'},{status:404});
  const {data,error}=await supabase.rpc(rpc,args);
  if(error)return Response.json({error:'storage_unavailable'},{status:503});
  if(!data||typeof data.status!=='number')return Response.json({error:'storage_unavailable'},{status:503});
  return Response.json(data.data,{status:data.status});
}
