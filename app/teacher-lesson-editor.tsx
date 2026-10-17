'use client';
import {useState,type FormEvent} from 'react';
import type {Entry} from '@/lib/domain';
import {berlinInput,berlinToUtc} from '@/lib/time';
import {api,Dialog,Fields} from './operations';
export default function TeacherLessonEditor({entry,students,onClose,onChange}:{entry:Entry;students:Entry[];onClose:()=>void;onChange:()=>Promise<void>}){
 const [studentId,setStudentId]=useState(entry.data.studentId||students.find(s=>s.data.active)?.id||'');
 const [subject,setSubject]=useState(entry.data.subject||students.find(s=>s.id===studentId)?.data.subject||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const existing=entry.version>0,held=entry.data.status==='gehalten';
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const f=new FormData(e.currentTarget);await api('/api/workflows',{action:'teacher-schedule',id:entry.id,version:entry.version,studentId,subject,start:berlinToUtc(String(f.get('start'))),minutes:Number(f.get('minutes')),location:String(f.get('location')||''),notes:String(f.get('notes')||'')});await onChange();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Dialog title={held?'Abgeschlossene Stunde bearbeiten':existing?'Termin verschieben / bearbeiten':'Termin mit Schüler vereinbaren'} close={()=>{if(!busy)onClose();}}><form onSubmit={save}><Fields>
  <label className="full">Schüler<select required disabled={existing||busy} value={studentId} onChange={e=>{setStudentId(e.target.value);setSubject(students.find(s=>s.id===e.target.value)?.data.subject||'');}}><option value="" disabled>Bitte wählen</option>{students.filter(s=>s.data.active||s.id===studentId).map(s=><option key={s.id} value={s.id}>{s.data.name}</option>)}</select></label>
  <label className="full">Fach<input required maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)} disabled={busy}/></label>
  <label>Beginn (Berlin)<input required type="datetime-local" name="start" defaultValue={entry.data.start?berlinInput(entry.data.start):entry.data.localStart||''} disabled={busy}/></label>
  <label>Dauer in Minuten<input required type="number" name="minutes" min="5" max="480" step="1" defaultValue={entry.data.minutes||60} disabled={busy}/></label>
  <label className="full">Ort / Online-Link<input name="location" maxLength={200} defaultValue={entry.data.location||''} disabled={busy}/></label>
  <label className="full">Notizen<textarea name="notes" maxLength={4000} defaultValue={entry.data.notes||''} disabled={busy}/></label>
 </Fields>{held&&<p className="info">Der Status bleibt „gehalten“. Korrekturen sind nur vor der Rechnungs- oder Honorarabrechnung möglich. Eine geänderte Dauer ändert den abrechenbaren Betrag. Lernbeobachtungen und Hausaufgaben bitte in ihren eigenen Bereichen korrigieren.</p>}<p className="info">Du wirst automatisch als Lehrkraft eingetragen. Kundenpreis und Honorar werden vom Inhaber vorgegeben. Beim Verschieben bleiben die bisherigen Sätze erhalten. Überschneidungen werden beim Speichern geprüft.</p>{entry.data.seriesId&&<p className="form-hint">Du änderst nur diesen Termin, nicht die gesamte Serie.</p>}{error&&<p className="alert" role="alert">{error}</p>}<div className="dialog-actions"><button className="primary" disabled={busy||!studentId}>{busy?'Speichert …':existing?'Änderung speichern':'Termin anlegen'}</button></div></form></Dialog>;
}
