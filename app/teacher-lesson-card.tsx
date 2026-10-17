'use client';
import type {Entry} from '@/lib/domain';
import CalendarDownload from './calendar-download';
export default function TeacherLessonCard({entry,name,onEdit,onComplete}:{entry:Entry;name:string;onEdit:(entry:Entry)=>void;onComplete:(entry:Entry)=>void}){
 const d=entry.data,start=new Date(d.start),planned=d.status==='geplant';
 return <article className="teacher-lesson-card">
  <div className="lesson teacher-lesson-summary">
   <div className="datebox"><strong>{start.toLocaleDateString('de-DE',{day:'2-digit',timeZone:'Europe/Berlin'})}</strong><span>{start.toLocaleDateString('de-DE',{month:'short',timeZone:'Europe/Berlin'})}</span></div>
   <div className="grow"><strong>{name}</strong><p>{d.subject} · {d.minutes} Min. · {start.toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</p><small>{d.location||'Ort noch offen'}</small>{d.notes&&<p className="preline">{d.notes}</p>}</div>
   <span className={'badge '+(d.status==='gehalten'?'green':'')}>{d.status}{d.seriesId?' · Serie':''}</span>
  </div>
  {d.status!=='abgesagt'&&<div className="teacher-lesson-actions">
   {(planned||d.status==='gehalten')&&!d.groupSessionId&&!d.groupId&&<button className="secondary" onClick={()=>onEdit(entry)}>{planned?'Verschieben / bearbeiten':'Abgeschlossene Stunde bearbeiten'}</button>}
   {planned&&Date.parse(d.start)<=Date.now()&&<button className="primary" onClick={()=>onComplete(entry)}>Stunde abschließen</button>}
   <CalendarDownload lessons={[entry]} single/>
  </div>}
 </article>;
}
