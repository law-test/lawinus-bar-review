import type {PersonalNote,PersonalReview,ReviewDraft,ReviewPaper} from './review-types';

export type SavedRecords={notes:PersonalNote[];reviews:PersonalReview[]};
export type HistoryRow={id:string;[key:string]:unknown};
export type HistoryPage={history:HistoryRow[];hasMore:boolean};

function stableRecords(value:SavedRecords):string {
  const ordered=<T extends {id?:string}>(rows:T[])=>[...rows].sort((a,b)=>(a.id??'').localeCompare(b.id??''));
  return JSON.stringify({notes:ordered(value.notes),reviews:ordered(value.reviews)});
}

// A backup is produced only after every page and a final consistency check succeed.
export async function collectRecordBackup(options:{
  readRecords:()=>Promise<SavedRecords>;readHistory:(offset:number)=>Promise<HistoryPage>;
  isCurrent:()=>boolean;noteDrafts:PersonalNote[];reviewDrafts:ReviewDraft[];catalogVersion?:string|number;
}){
  const check=()=>{if(!options.isCurrent())throw Error('기록이 변경되었습니다. 저장을 마친 뒤 다시 내보내 주세요.');};
  check();
  const drafts=JSON.parse(JSON.stringify({notes:options.noteDrafts,reviews:options.reviewDrafts})) as {notes:PersonalNote[];reviews:ReviewDraft[]};
  const saved=await options.readRecords();check();
  const history:HistoryRow[]=[],ids=new Set<string>();let firstPage:HistoryPage|undefined;
  for(;;){
    const page=await options.readHistory(history.length);check();
    if(!Array.isArray(page.history)||typeof page.hasMore!=='boolean'||(page.hasMore&&!page.history.length))throw Error('변경 이력 전체를 확인하지 못했습니다. 다시 내보내 주세요.');
    firstPage??=page;
    for(const row of page.history){
      if(!row||typeof row.id!=='string'||ids.has(row.id))throw Error('변경 이력을 읽는 동안 기록이 바뀌었습니다. 다시 내보내 주세요.');
      ids.add(row.id);history.push(row);
    }
    if(!page.hasMore)break;
  }
  const latest=await options.readRecords();check();
  const latestHead=await options.readHistory(0);check();
  if(stableRecords(saved)!==stableRecords(latest)||JSON.stringify(firstPage)!==JSON.stringify(latestHead)){
    throw Error('내보내는 동안 기록이 변경되었습니다. 다시 내보내 주세요.');
  }
  return {formatVersion:2,exportedAt:new Date().toISOString(),catalogVersion:options.catalogVersion,
    personalNotes:saved.notes,unsavedNoteDrafts:drafts.notes,personalReviews:saved.reviews,
    unsavedReviewDrafts:drafts.reviews,recordHistory:history};
}

export function reconnectNote(note:PersonalNote,paper:ReviewPaper):PersonalNote{
  if(paper.id!==note.paperId)throw Error('메모가 연결된 시험지를 확인할 수 없습니다. 기존 메모는 유지됩니다.');
  const question=paper.questions.find(row=>row.id===note.questionId);
  if(!question)throw Error('메모가 연결된 문항을 찾을 수 없습니다. 기존 메모와 인용문은 유지됩니다.');
  if(note.atomId&&!question.atoms.some(row=>row.id===note.atomId))throw Error('메모가 연결된 atom을 찾을 수 없습니다. 기존 메모와 인용문은 유지됩니다.');
  if(!question.contentHash)throw Error('최신 본문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return {...note,contentHash:question.contentHash};
}
