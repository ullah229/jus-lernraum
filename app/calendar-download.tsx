'use client';
import {Download} from 'lucide-react';
import {ics,type Entry} from '@/lib/domain';
import {collapseGroupLessons} from '@/lib/group-view';
export default function CalendarDownload({lessons,single=false}:{lessons:Entry[];single?:boolean}){
 const entries=collapseGroupLessons(lessons.filter(l=>l.kind==='lesson'&&l.data.status!=='abgesagt'));
 function download(){
  const url=URL.createObjectURL(new Blob([ics(entries)],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=single?'jus-termin.ics':'jus-meine-termine.ics';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <button type="button" className={single?'text-button':'secondary'} disabled={!entries.length} onClick={download}><Download size={16}/>{single?'Termin als Kalenderdatei speichern':'Meine Termine exportieren'}</button>;
}
