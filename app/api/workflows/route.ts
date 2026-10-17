import {payrollLessons,payrollAmount} from '@/lib/group-payroll';
import {canLesson,teamGuards,validateTeacher,teacherGuards} from '@/lib/team';
import {lessonGuard,invoicePaymentPredicate} from '@/lib/transaction-guards';
import {z} from 'zod';
import {schemas,billable} from '@/lib/domain';
import {seriesDates,amounts,berlinDay,profileSchema} from '@/lib/workflows';
import {access,out,database,jsonBody,snapshot,failure,validId} from '@/lib/server-data';
export const dynamic='force-dynamic';
export async function POST(req:Request){const a=await access(req);if(a.error)return a.error;try{
 const b=await jsonBody(req,100000),db=database(),owner=a.owner!,now=new Date().toISOString();
 if(a.role!=='admin'&&!['complete','teacher-schedule'].includes(b.action))return out({error:'Nur für den Inhaber.'},403);
 const fail=(s:string)=>out({error:s},400);
 const get=async(id:string)=>db.prepare('SELECT * FROM records WHERE id=? AND owner=? AND deleted IS NULL').bind(id,owner).first<any>();
 const insert=(id:string,kind:string,data:unknown)=>db.prepare('INSERT INTO records(id,owner,kind,data,version,updated) VALUES(?,?,?,?,1,?)').bind(id,owner,kind,JSON.stringify(data),now);
 const guard=(id:string,version:number)=>db.prepare('INSERT INTO workflow_guards(id,valid) VALUES(?,(SELECT COUNT(*) FROM records WHERE id=? AND owner=? AND version=? AND deleted IS NULL))').bind(crypto.randomUUID(),id,owner,version);
 const history=(r:any)=>db.prepare('INSERT INTO history(id,owner,record_id,kind,data,version,action,changed) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,r.id,r.kind,r.data,r.version,'Arbeitsablauf',now);
 const update=(r:any,data:any)=>db.prepare('UPDATE records SET data=?,version=version+1,updated=? WHERE id=? AND owner=?').bind(JSON.stringify(data),now,r.id,owner);
 if(b.action==='teacher-schedule'){
  if(a.role!=='teacher')return out({error:'Dieser Ablauf ist für Lehrkräfte vorgesehen.'},403);
  const parsed=z.object({action:z.literal('teacher-schedule'),id:z.string().uuid(),version:z.number().int().nonnegative(),studentId:z.string().uuid(),subject:z.string().trim().min(1).max(160),start:z.string().datetime(),minutes:z.number().int().min(5).max(480),location:z.string().max(200),notes:z.string().max(4000)}).strict().safeParse(b);
  if(!parsed.success)return fail('Bitte prüfe Schüler, Beginn, Dauer und die übrigen Terminangaben. Preise und Lehrkraft sind nicht änderbar.');
  const input=parsed.data;
  if(!a.assigned.includes(input.studentId))return out({error:'Kein Zugriff auf diesen Schüler.'},403);
  const old=await get(input.id);
  if(old&&(old.kind!=='lesson'||!canLesson(a,JSON.parse(old.data))))return out({error:'Du darfst nur deine eigenen Termine bearbeiten.'},403);
  if((old&&old.version!==input.version)||(!old&&input.version!==0))return out({error:'Termin wurde geändert. Bitte aktualisieren.'},409);
  const previous=old?JSON.parse(old.data):null;
  if(previous&&(!['geplant','gehalten'].includes(previous.status)||previous.groupSessionId||previous.groupId))return fail('Nur geplante oder gehaltene Einzeltermine können hier bearbeitet werden. Gruppentermine verwaltet der Inhaber.');
  const held=previous?.status==='gehalten';
  if(held?Date.parse(input.start)>Date.now():Date.parse(input.start)<=Date.now())return fail(held?'Eine gehaltene Stunde darf nicht in die Zukunft verschoben werden.':'Bitte einen zukünftigen Beginn wählen.');
  if(old&&(await db.prepare('SELECT lesson_id FROM invoice_lines WHERE lesson_id=? AND owner=? UNION ALL SELECT lesson_id FROM payroll_claims WHERE lesson_id=? AND owner=?').bind(old.id,owner,old.id,owner).first()))return out({error:'Diese Stunde ist bereits in einer Rechnung oder Honorarabrechnung enthalten. Bitte den Inhaber um Korrektur der Abrechnung bitten.'},409);
  if(previous&&previous.studentId!==input.studentId)return fail('Der Schüler eines bestehenden Termins kann nicht gewechselt werden.');
  const pupil=await get(input.studentId);
  if(pupil?.kind!=='student'||!JSON.parse(pupil.data).active)return fail('Bitte einen aktiven Schüler wählen.');
  const member=await db.prepare('SELECT rate,version FROM team_members WHERE id=? AND owner=? AND user_id=? AND active=1').bind(a.memberId,owner,a.actor).first<any>();
  if(!member)return out({error:'Kein aktiver Lehrkräftezugang.'},403);
  const data=schemas.lesson.parse({...previous,studentId:input.studentId,subject:input.subject,start:input.start,minutes:input.minutes,location:input.location,notes:input.notes,status:held?'gehalten':'geplant',teacherId:a.memberId,rate:previous?previous.rate:JSON.parse(pupil.data).rate,payRate:previous?previous.payRate:member.rate});
  const conflictSql="SELECT 1 FROM records WHERE owner=? AND id!=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.status')='geplant' AND (json_extract(data,'$.studentId')=? OR json_extract(data,'$.teacherId')=?) AND julianday(?)<julianday(json_extract(data,'$.start'))+json_extract(data,'$.minutes')/1440.0 AND julianday(?)+?/1440.0>julianday(json_extract(data,'$.start'))";
  const conflictArgs=[owner,input.id,data.studentId,a.memberId!,data.start,data.start,data.minutes];
  if(await db.prepare(conflictSql).bind(...conflictArgs).first())return out({error:'Der Schüler oder du hast zu dieser Zeit bereits Unterricht. Bitte eine andere Zeit wählen.'},409);
  const changes=[...teamGuards(a,data.studentId),guard(pupil.id,pupil.version),db.prepare('INSERT INTO workflow_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM team_members WHERE id=? AND owner=? AND version=? AND active=1 AND user_id=?))').bind(crypto.randomUUID(),a.memberId,owner,member.version,a.actor),db.prepare('INSERT INTO workflow_guards(id,valid) VALUES(?,NOT EXISTS('+conflictSql+'))').bind(crypto.randomUUID(),...conflictArgs)];
  if(old)changes.push(guard(old.id,old.version),lessonGuard(owner,old.id),history(old),update(old,data));else changes.push(insert(input.id,'lesson',data));
  await snapshot(owner);
  try{await db.batch([...changes,db.prepare('DELETE FROM workflow_guards')]);}catch(e){if(/constraint/i.test(String(e)))return out({error:'Termin oder Berechtigungen wurden inzwischen geändert, der Termin ist bereits abgerechnet oder die Zeit ist jetzt belegt. Bitte aktualisieren.'},409);throw e;}
  return out({ok:true,id:input.id});
 }
 if(b.action==='group-session'){
 if(!validId(b.id)||!validId(b.groupId))return fail('Gruppe oder Termin fehlt.');const duplicate=await get(b.id);if(duplicate)return duplicate.kind==='lesson'&&JSON.parse(duplicate.data).groupSessionId===b.id?out({ok:true,replayed:true}):fail('Kennung bereits verwendet.');
 const group=await get(b.groupId);if(group?.kind!=='group')return fail('Gruppe fehlt.');const g=schemas.group.parse(JSON.parse(group.data));if(!g.active)return fail('Diese Gruppe ist archiviert.');
 const lessons=[];for(const studentId of g.studentIds){const pupil=await get(studentId);if(pupil?.kind!=='student'||!JSON.parse(pupil.data).active)return fail('Alle Teilnehmer müssen aktive Schüler sein.');const d=schemas.lesson.parse({studentId,subject:g.subject,start:b.start,minutes:b.minutes,rate:g.rate,status:'geplant',location:b.location||'',notes:'',teacherId:g.teacherId,payRate:g.teacherId?b.payRate:undefined,groupId:group.id,groupName:g.name,groupSessionId:b.id});await validateTeacher(owner,d);lessons.push(d);}
 const guards=[guard(group.id,group.version)];for(const d of lessons){guards.push(...teacherGuards(owner,d),db.prepare("INSERT INTO workflow_guards(id,valid) VALUES(?,NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.status')='geplant' AND (json_extract(data,'$.studentId')=? OR COALESCE(json_extract(data,'$.teacherId'),'')=?) AND julianday(?)<julianday(json_extract(data,'$.start'))+json_extract(data,'$.minutes')/1440.0 AND julianday(?)+?/1440.0>julianday(json_extract(data,'$.start'))))").bind(crypto.randomUUID(),owner,d.studentId,d.teacherId||'',d.start,d.start,d.minutes));}
 await snapshot(owner);await db.batch([...guards,...lessons.map((d,i)=>insert(i===0?b.id:crypto.randomUUID(),'lesson',d)),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 if(b.action==='cancel-group-session'){
 if(!validId(b.id))return fail('Gruppentermin fehlt.');const rs=(await db.prepare("SELECT * FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.groupSessionId')=?").bind(owner,b.id).all<any>()).results;if(!rs.length)return fail('Gruppentermin fehlt.');if(rs.every(r=>JSON.parse(r.data).status==='abgesagt'))return out({ok:true});if(rs.some(r=>JSON.parse(r.data).status!=='geplant'))return fail('Bereits dokumentierte Gruppenstunden können nicht gemeinsam abgesagt werden.');await snapshot(owner);await db.batch([...rs.flatMap(r=>[guard(r.id,r.version),lessonGuard(owner,r.id),history(r),update(r,{...JSON.parse(r.data),status:'abgesagt'})]),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 if(b.action==='series'){
 const lesson=schemas.lesson.parse(b.lesson);if(lesson.groupSessionId||lesson.groupId)return fail('Gruppentermine bitte über Gruppen planen.');if(lesson.status!=='geplant'||!validId(b.id))return fail('Eine Serie beginnt mit geplanten Stunden.');
 const student=await get(lesson.studentId);if(student?.kind!=='student')return fail('Schüler fehlt.');
 await validateTeacher(owner,lesson);
 const excludes=z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(100).parse(b.excluded||[]);const dates=seriesDates(lesson.start,b.count,b.interval,excludes);
 if(await get(b.id))return out({ok:true,replayed:true});
 const existing=(await db.prepare("SELECT data FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL").bind(owner).all<any>()).results.map(r=>JSON.parse(r.data)).filter(r=>r.status==='geplant'&&(r.studentId===lesson.studentId||(r.teacherId||'')===(lesson.teacherId||'')));
 if(dates.some(start=>existing.some(r=>Date.parse(start)<Date.parse(r.start)+r.minutes*60000&&Date.parse(start)+lesson.minutes*60000>Date.parse(r.start))))return fail('Mindestens ein Termin überschneidet sich mit einem geplanten Unterricht. Bitte Beginn oder Ausnahmen anpassen.');
 await snapshot(owner);await db.batch([...teacherGuards(owner,lesson),...dates.map(start=>db.prepare("INSERT INTO workflow_guards(id,valid) VALUES(?,NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.status')='geplant' AND (json_extract(data,'$.studentId')=? OR COALESCE(json_extract(data,'$.teacherId'),'')=?) AND julianday(?)<julianday(json_extract(data,'$.start'))+json_extract(data,'$.minutes')/1440.0 AND julianday(?)+?/1440.0>julianday(json_extract(data,'$.start'))))").bind(crypto.randomUUID(),owner,lesson.studentId,lesson.teacherId||'',start,start,lesson.minutes)),...dates.map((start,i)=>insert(i===0?b.id:crypto.randomUUID(),'lesson',{...lesson,start,seriesId:b.id})),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true,count:dates.length});
 }
 if(b.action==='cancel-series'){
 if(!validId(b.id))return fail('Serie fehlt.');const from=z.string().datetime().parse(b.from);
 const rs=(await db.prepare("SELECT * FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.seriesId')=? AND json_extract(data,'$.status')='geplant' AND json_extract(data,'$.start')>=?").bind(owner,b.id,from).all<any>()).results;
 if(!rs.length)return out({ok:true,count:0});await snapshot(owner);await db.batch(rs.flatMap(r=>[guard(r.id,r.version),lessonGuard(owner,r.id),history(r),update(r,{...JSON.parse(r.data),status:'abgesagt'})]).concat([db.prepare('DELETE FROM workflow_guards')]));return out({ok:true,count:rs.length});
 }
 if(b.action==='complete'){
 if(!validId(b.id))return fail('Termin fehlt.');const r=await get(b.id);if(r?.kind!=='lesson'||r.version!==b.version)return out({error:'Termin wurde geändert. Bitte neu laden.'},409);
 const old=JSON.parse(r.data);if(!canLesson(a,old))return out({error:'Du darfst nur eigene zugewiesene Stunden abschließen.'},403);if(old.status!=='geplant')return fail('Nur geplante Stunden können abgeschlossen werden.');if(Date.parse(old.start)>Date.now())return fail('Die Stunde hat noch nicht begonnen.');
 const attendance=z.enum(['anwesend','nicht erschienen']).parse(b.attendance);const data=schemas.lesson.parse({...old,status:attendance==='anwesend'?'gehalten':'abgesagt',attendance,notes:b.notes});
 const changes=[...teamGuards(a,old.studentId),guard(r.id,r.version),lessonGuard(owner,r.id),history(r),update(r,data)];
 if(attendance==='anwesend'&&b.progress)changes.push(insert(crypto.randomUUID(),'progress',schemas.progress.parse({...b.progress,studentId:old.studentId,date:berlinDay(old.start)})));
 if(attendance==='anwesend'&&b.homework){const hw=schemas.homework.parse({...b.homework,studentId:old.studentId,lessonId:r.id,status:'offen'});for(const id of [...hw.fileIds,...hw.solutionFileIds]){if(!await db.prepare('SELECT id FROM files WHERE id=? AND owner=? AND student_id=? AND deleted IS NULL').bind(id,owner,old.studentId).first())return fail('Ein Material gehört nicht zu diesem Schüler.');}changes.push(insert(crypto.randomUUID(),'homework',hw));}
 await snapshot(owner);await db.batch([...changes,db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 if(b.action==='invoice'){
 if(!validId(b.id)||!validId(b.studentId))return fail('Ungültige Rechnung.');const duplicate=await get(b.id);if(duplicate?.kind==='invoice')return out({ok:true,id:b.id});
 const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(b.month),recipient=z.string().trim().min(5).max(4000).parse(b.recipient);
 const profile=await db.prepare("SELECT * FROM records WHERE owner=? AND kind='profile' AND deleted IS NULL").bind(owner).first<any>();if(!profile)return fail('Bitte zuerst die Rechnungsdaten einrichten.');const issuer=profileSchema.parse(JSON.parse(profile.data));
 const rs=(await db.prepare("SELECT * FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL AND json_extract(data,'$.studentId')=? AND NOT EXISTS(SELECT 1 FROM invoice_lines WHERE lesson_id=records.id)").bind(owner,b.studentId).all<any>()).results.filter(r=>{const d=JSON.parse(r.data);return d.status==='gehalten'&&berlinDay(d.start).startsWith(month);}).sort((a,b)=>JSON.parse(a.data).start.localeCompare(JSON.parse(b.data).start));
 if(!rs.length||rs.length>100)return fail('Es sind keine oder mehr als 100 noch nicht abgerechnete Stunden vorhanden.');
 const lines=rs.map(r=>{const d=JSON.parse(r.data);return {lessonId:r.id,start:d.start,subject:d.subject,minutes:d.minutes,rate:d.rate,amount:billable(d)};});const issued=berlinDay(),year=issued.slice(0,4);const dueDate=new Date(issued+'T12:00:00Z');dueDate.setUTCDate(dueDate.getUTCDate()+issuer.paymentDays);
 const data={studentId:b.studentId,number:'',issued,due:dueDate.toISOString().slice(0,10),month,recipient,issuer,lines,...amounts(lines,issuer.taxMode),status:'issued'};
 await snapshot(owner);
 // Number and lesson claims are allocated inside the same SQLite transaction.
 await db.batch([guard(profile.id,profile.version),...rs.map(r=>guard(r.id,r.version)),db.prepare("INSERT INTO records(id,owner,kind,data,version,updated) SELECT ?,?,'invoice',json_set(?,'$.number',? || printf('%06d',COALESCE(MAX(CAST(substr(json_extract(data,'$.number'),10) AS INTEGER)),0)+1)),1,? FROM records WHERE owner=? AND kind='invoice' AND json_extract(data,'$.number') LIKE ?").bind(b.id,owner,JSON.stringify(data),'JUS-'+year+'-',now,owner,'JUS-'+year+'-%'),...rs.map(r=>db.prepare('INSERT INTO invoice_lines(lesson_id,invoice_id,owner) VALUES(?,?,?)').bind(r.id,b.id,owner)),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true,id:b.id});
 }
 if(b.action==='void-invoice'){
 if(!validId(b.id))return fail('Rechnung fehlt.');const r=await get(b.id);if(r?.kind!=='invoice'||r.version!==b.version)return out({error:'Rechnung wurde geändert.'},409);const d=JSON.parse(r.data);if(d.status!=='issued')return fail('Bereits storniert.');if(await db.prepare(`SELECT id FROM records WHERE owner=? AND kind='payment' AND deleted IS NULL AND ${invoicePaymentPredicate}`).bind(owner,b.id,b.id).first())return fail('Zugeordnete Zahlungen zuerst bearbeiten und die Rechnungszuordnung entfernen.');const reason=z.string().trim().min(3).max(500).parse(b.reason);await snapshot(owner);await db.batch([guard(r.id,r.version),db.prepare(`INSERT INTO workflow_guards(id,valid) VALUES(?,NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='payment' AND deleted IS NULL AND ${invoicePaymentPredicate}))`).bind(crypto.randomUUID(),owner,r.id,r.id),history(r),update(r,{...d,status:'void',voidReason:reason,voided:now}),db.prepare('DELETE FROM invoice_lines WHERE invoice_id=? AND owner=?').bind(r.id,owner),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 if(b.action==='payroll'){
 if(!validId(b.id)||!validId(b.memberId))return fail('Lehrkraft fehlt.');const duplicate=await get(b.id);if(duplicate?.kind==='payroll')return out({ok:true,id:b.id});const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(b.month);
 const member=await db.prepare('SELECT * FROM team_members WHERE id=? AND owner=?').bind(b.memberId,owner).first<any>();if(!member)return fail('Lehrkraft fehlt.');
 const all=(await db.prepare("SELECT * FROM records WHERE owner=? AND kind='lesson' AND deleted IS NULL").bind(owner).all<any>()).results;const claimRows=await db.prepare('SELECT lesson_id FROM payroll_claims WHERE owner=?').bind(owner).all<any>();const selected=payrollLessons(all.map(r=>({...r,data:JSON.parse(r.data)})),b.memberId,month,new Set(claimRows.results.map(r=>r.lesson_id)));const rs=all.filter(r=>selected.some(s=>s.id===r.id));if(!rs.length||rs.length>100)return fail('Keine oder mehr als 100 abrechenbare Teilnehmerstunden. Gruppentermine zuerst für alle Teilnehmer abschließen.');
 const lines=selected.map(r=>{const d=r.data;if(!Number.isInteger(d.payRate))throw Error('TEACHER_RATE');return {lessonId:r.id,start:d.start,subject:(d.groupName?d.groupName+' · ':'')+d.subject,minutes:d.minutes,payRate:d.payRate,amount:payrollAmount(r,selected)};});const data=schemas.payroll.parse({memberId:b.memberId,memberName:member.name,month,status:'offen',total:lines.reduce((n,l)=>n+l.amount,0),issued:now,lines,note:''});await snapshot(owner);await db.batch([...rs.map(r=>guard(r.id,r.version)),insert(b.id,'payroll',data),...rs.map(r=>db.prepare('INSERT INTO payroll_claims(lesson_id,statement_id,owner) VALUES(?,?,?)').bind(r.id,b.id,owner)),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true,id:b.id});
 }
 if(b.action==='payroll-status'){
 if(!validId(b.id))return fail('Abrechnung fehlt.');const r=await get(b.id);if(r?.kind!=='payroll'||r.version!==b.version)return out({error:'Abrechnung wurde geändert.'},409);const d=JSON.parse(r.data);if(d.status!=='offen')return fail('Nur offene Abrechnungen können bezahlt markiert oder storniert werden.');const status=z.enum(['bezahlt','storniert']).parse(b.status);const note=z.string().trim().max(500).parse(b.note||'');if(status==='storniert'&&note.length<3)return fail('Bitte einen Stornogrund angeben.');await snapshot(owner);await db.batch([guard(r.id,r.version),history(r),update(r,{...d,status,note,...(status==='bezahlt'?{paidAt:now}:{})}),...(status==='storniert'?[db.prepare('DELETE FROM payroll_claims WHERE statement_id=? AND owner=?').bind(r.id,owner)]:[]),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 return fail('Unbekannter Arbeitsablauf.');
 }catch(e){if(e instanceof z.ZodError)return out({error:'Eingaben prüfen: '+e.issues.map(i=>i.message).join(' ')},400);if(String(e).includes('constraint')||String(e).includes('BILLED'))return out({error:'Daten wurden geändert oder Stunden sind bereits abgerechnet. Bitte aktualisieren.'},409);if(e instanceof Error&&/Serie:|Uhrzeit|ausgeschlossen/.test(e.message))return out({error:e.message},400);return failure(e);}}
