import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);const deps=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=deps('miniflare');const {build}=deps('esbuild');
const result=await build({stdin:{contents:`import * as calendar from './app/api/calendar/route';import * as calendarFeed from './app/api/calendar/feed/route';import * as team from './app/api/team/route';import * as workflows from './app/api/workflows/route';import * as backup from './app/api/backup/route';import * as invoice from './app/api/invoice/route';import * as records from './app/api/records/route';import * as files from './app/api/files/route';import * as recovery from './app/api/recovery/route';export default {async fetch(req){globalThis.__testUser=req.headers.get('X-Test-User');const routes={'/api/calendar':calendar,'/api/calendar/feed':calendarFeed,'/api/team':team,'/api/workflows':workflows,'/api/backup':backup,'/api/invoice':invoice,'/api/records':records,'/api/files':files,'/api/recovery':recovery};const route=routes[new URL(req.url).pathname];return route?.[req.method]?route[req.method](req):new Response('Not found',{status:404});}}`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],plugins:[{name:'test-identity',setup(b){b.onResolve({filter:/chatgpt-auth$/},()=>({path:'test-auth',namespace:'test-only'}));b.onLoad({filter:/.*/,namespace:'test-only'},()=>({contents:'export async function getChatGPTUser(){const id=globalThis.__testUser;return id?{userId:id,email:id+"@test.invalid"}:null;}',loader:'js'}));}}]});
const mf=new Miniflare({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{JUS_OWNER_ID:'owner-test'}});
const db=await mf.getD1Database('DB');const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
for(const {tag} of journal.entries){const sql=await readFile(`drizzle/${tag}.sql`,'utf8');for(const stmt of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(stmt).run();}
const owner='owner-test',other='other-test';
async function call(path,method='GET',body,who=owner,origin='http://localhost'){const headers={};if(who)headers['X-Test-User']=who;if(method!=='GET')headers.Origin=origin;if(body instanceof FormData){const encoded=new Request('http://localhost',{method:'POST',body});headers['Content-Type']=encoded.headers.get('Content-Type');body=new Uint8Array(await encoded.arrayBuffer());}else if(body){headers['Content-Type']='application/json';body=JSON.stringify(body);}return mf.dispatchFetch('http://localhost'+path,{method,headers,body});}
async function json(r){const text=await r.text();try{return JSON.parse(text);}catch{throw Error(`${r.status}: ${text}`);}}
const studentId=randomUUID(),lessonId=randomUUID();
const student={name:'Test Schüler',grade:'6',subject:'Mathematik',contact:'Test',email:'',rate:2500,goal:'Brüche',active:true};
const lesson={studentId,subject:'Mathematik',start:'2026-10-12T13:00:00.000Z',minutes:60,rate:2500,status:'gehalten',location:'Test',notes:''};
const save=(id,kind,data,version=0)=>({action:'save',id,kind,data,version});
try{
await test('API verweigert anonyme und fremde Origin-Schreibzugriffe',async()=>{
 for(const path of ['/api/records','/api/files','/api/recovery','/api/backup','/api/invoice'])assert.equal((await call(path,'GET',undefined,null)).status,401);
 assert.equal((await call('/api/records','POST',save(studentId,'student',student),owner,'https://foreign.invalid')).status,403);
 assert.equal((await call('/api/records','POST',save(studentId,'student',student),null)).status,401);
});
await test('Persistente CRUD-Daten bleiben benutzergetrennt und Sicherung entsteht',async()=>{
 let r=await call('/api/records','POST',save(studentId,'student',student));assert.equal(r.status,200,JSON.stringify(await json(r)));
 assert.equal((await call('/api/records','POST',save(lessonId,'lesson',lesson))).status,200);
 const own=await json(await call('/api/records'));assert.equal(own.length,2);assert.equal(own.find(r=>r.id===lessonId).data.rate,2500);
 assert.equal((await call('/api/records','GET',undefined,other)).status,403);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'lesson',lesson),other)).status,403);
 assert.equal((await call('/api/records','POST',save(studentId,'student',student,1),other)).status,403);
 const rec=await json(await call('/api/recovery'));assert.equal(rec.backups.length,1);
 const backup=await json(await call('/api/recovery?backup='+rec.backups[0].date));assert.equal(backup.format,'jus-lernraum-v2');assert.equal(backup.records.length,0);
});
await test('Optimistische Sperre, Papierkorb und frühere Datenstände funktionieren',async()=>{
 assert.equal((await call('/api/records','POST',save(lessonId,'lesson',{...lesson,minutes:90},1))).status,200);
 assert.equal((await call('/api/records','POST',save(lessonId,'lesson',{...lesson,minutes:30},1))).status,409);
 let rec=await json(await call('/api/recovery'));const h=rec.history.find(h=>h.recordId===lessonId);assert.equal(h.data.minutes,60);
 assert.equal((await call('/api/recovery','POST',{action:'restore-history',id:h.id,version:2})).status,200);
 assert.equal((await json(await call('/api/records'))).find(r=>r.id===lessonId).data.minutes,60);
 assert.equal((await call('/api/records','POST',{action:'delete',id:lessonId,kind:'lesson',version:3})).status,200);
 assert.equal((await json(await call('/api/records'))).length,1);
 rec=await json(await call('/api/recovery'));assert.equal(rec.records[0].id,lessonId);
 assert.equal((await call('/api/recovery','POST',{action:'restore-record',id:lessonId,version:4})).status,200);
 assert.equal((await json(await call('/api/records'))).length,2);
});
let fileId;
await test('Schülerdatei: Upload, Bytes, isolierter Download, Löschen und Wiederherstellung',async()=>{
 const form=new FormData();form.set('studentId',studentId);form.set('file',new Blob(['%PDF-1.4\nTestdatei'],{type:'application/pdf'}),'test.pdf');
 const r=await call('/api/files','POST',form);const d=await json(r);assert.equal(r.status,201,JSON.stringify(d));fileId=d.id;
 const list=await json(await call('/api/files'));assert.equal(list.length,1);assert.equal(list[0].studentId,studentId);
 assert.equal((await call('/api/files?download='+fileId,'GET',undefined,other)).status,403);
 const download=await call('/api/files?download='+fileId);assert.equal(download.headers.get('Content-Type'),'application/octet-stream');assert.equal(await download.text(),'%PDF-1.4\nTestdatei');
 assert.equal((await call('/api/files','POST',{action:'delete',id:fileId})).status,200);assert.equal((await call('/api/files?download='+fileId)).status,404);
 assert.equal((await call('/api/recovery','POST',{action:'restore-file',id:fileId})).status,200);assert.equal((await call('/api/files?download='+fileId)).status,200);
});
await test('Ungültige Uploads und fremde Schülerzuordnung werden abgewiesen',async()=>{
 const form=new FormData();form.set('studentId',studentId);form.set('file',new Blob(['<script>alert(1)</script>']),'x.pdf');assert.equal((await call('/api/files','POST',form)).status,400);
 const valid=new FormData();valid.set('studentId',studentId);valid.set('file',new Blob(['%PDF-1.4\nTest']),'x.pdf');assert.equal((await call('/api/files','POST',valid,other)).status,403);
 assert.equal((await call('/api/recovery','POST',{action:'restore-file',id:fileId},other)).status,403);
});
await test('JSON-Wiederherstellung ist idempotent und überschreibt aktive Daten nicht',async()=>{
 const records=await json(await call('/api/records'));const backup={format:'jus-lernraum-v2',records};
 let r=await call('/api/recovery','POST',{action:'import',backup});let d=await json(r);assert.equal(d.restored,0);assert.equal(d.skipped,2);
 const current=records.find(r=>r.id===lessonId);assert.equal((await call('/api/records','POST',{action:'delete',id:lessonId,kind:'lesson',version:current.version})).status,200);
 d=await json(await call('/api/recovery','POST',{action:'import',backup}));assert.equal(d.restored,1);
 assert.equal((await json(await call('/api/records'))).find(r=>r.id===lessonId).data.minutes,60);
 const broken={format:'jus-lernraum-v2',records:[{id:randomUUID(),kind:'lesson',data:{...lesson,studentId:randomUUID()}}]};assert.equal((await call('/api/recovery','POST',{action:'import',backup:broken})).status,400);
});
await test('Import mit fremden Kennungen wird atomar verweigert',async()=>{
 const backup={format:'jus-lernraum-v2',records:[{id:studentId,kind:'student',data:student},{id:randomUUID(),kind:'lesson',data:lesson}]};
 assert.equal((await call('/api/recovery','POST',{action:'import',backup},other)).status,403);
 assert.equal((await call('/api/records','GET',undefined,other)).status,403);
});
await test('Gleichzeitige Änderungen verlieren keinen Stand',async()=>{
 const current=(await json(await call('/api/records'))).find(r=>r.id===lessonId);
 const result=await Promise.all([call('/api/records','POST',save(lessonId,'lesson',{...lesson,minutes:70},current.version)),call('/api/records','POST',save(lessonId,'lesson',{...lesson,minutes:80},current.version))]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const next=(await json(await call('/api/records'))).find(r=>r.id===lessonId);assert.equal(next.version,current.version+1);
});
await test('Endgültiges Dateilöschen entfernt den Objektinhalt',async()=>{
 await call('/api/files','POST',{action:'delete',id:fileId});assert.equal((await call('/api/recovery','POST',{action:'purge-file',id:fileId})).status,200);
 assert.equal((await call('/api/recovery','POST',{action:'restore-file',id:fileId})).status,404);
 const b=await mf.getR2Bucket('BUCKET');assert.equal((await b.list({prefix:'files/'})).objects.length,0);
});

const seriesId=randomUUID(),completionId=randomUUID(),invoiceId=randomUUID(),profileId=randomUUID();
await test('Terminserien halten Berliner Uhrzeit über die Zeitumstellung und vermeiden Wiederholungen',async()=>{
 const body={action:'series',id:seriesId,lesson:{...lesson,start:'2027-03-21T14:00:00.000Z',status:'geplant'},count:4,interval:1,excluded:['2027-04-04']};
 let r=await call('/api/workflows','POST',body);assert.equal(r.status,200,JSON.stringify(await json(r)));
 assert.equal((await call('/api/workflows','POST',body)).status,200);
 let list=(await json(await call('/api/records'))).filter(r=>r.data.seriesId===seriesId);
 assert.equal(list.length,3);assert.deepEqual(list.map(r=>r.data.start).sort(),['2027-03-21T14:00:00.000Z','2027-03-28T13:00:00.000Z','2027-04-11T13:00:00.000Z']);
 assert.equal((await call('/api/workflows','POST',{...body,id:randomUUID()})).status,400);
 assert.equal((await call('/api/workflows','POST',{action:'cancel-series',id:seriesId,from:'2027-03-28T13:00:00.000Z'})).status,200);
 list=(await json(await call('/api/records'))).filter(r=>r.data.seriesId===seriesId);assert.equal(list.filter(r=>r.data.status==='abgesagt').length,2);
});
await test('Stundenabschluss ist atomar und legt Lernstand und Hausaufgabe genau einmal an',async()=>{
 assert.equal((await call('/api/records','POST',save(completionId,'lesson',{...lesson,start:'2026-09-01T13:00:00.000Z',status:'geplant'}))).status,200);
 const body={action:'complete',id:completionId,version:1,attendance:'anwesend',notes:'Brüche geübt',progress:{topic:'Brüche',level:'mit Hilfe',correct:3,total:4,notes:'',next:'Vertiefen'},homework:{title:'Seite 12',instructions:'Aufgabe 3',due:'2026-09-08',fileIds:[]}};
 assert.equal((await call('/api/workflows','POST',{...body,progress:{...body.progress,correct:5}})).status,400);
 assert.equal((await json(await call('/api/records'))).find(r=>r.id===completionId).data.status,'geplant');
 assert.equal((await call('/api/workflows','POST',body)).status,200);
 assert.equal((await call('/api/workflows','POST',body)).status,409);
 const list=await json(await call('/api/records'));assert.equal(list.find(r=>r.id===completionId).data.status,'gehalten');assert.equal(list.filter(r=>r.kind==='homework').length,1);assert.equal(list.filter(r=>r.kind==='progress').length,1);
});
await test('Rechnungen sind nummeriert, gegen Doppelabrechnung geschützt und druckbar',async()=>{
 const profile={name:'JUS Test',address:'Teststraße 1\n60311 Frankfurt',taxId:'TEST',email:'',iban:'',taxMode:'19',exemption:'',paymentDays:14};
 assert.equal((await call('/api/records','POST',save(profileId,'profile',profile))).status,200);
 const body={action:'invoice',id:invoiceId,studentId,month:'2026-09',recipient:'Test Familie\nTeststraße 1'};
 let res=await call('/api/workflows','POST',body);assert.equal(res.status,200,JSON.stringify(await json(res)));
 assert.equal((await call('/api/workflows','POST',body)).status,200);
 assert.equal((await call('/api/workflows','POST',{...body,id:randomUUID()})).status,400);
 const inv=(await json(await call('/api/records'))).find(r=>r.id===invoiceId);assert.match(inv.data.number,/^JUS-\d{4}-000001$/);assert.equal(inv.data.gross,2500);assert.equal(inv.data.net+inv.data.tax,2500);
 assert.equal((await call('/api/records','POST',save(completionId,'lesson',lesson,2))).status,409);
 const print=await call('/api/invoice?id='+invoiceId);assert.equal(print.status,200);assert.match(await print.text(),/19 %/);
 assert.equal((await call('/api/invoice?id='+invoiceId,'GET',undefined,other)).status,403);
 assert.equal((await call('/api/records','POST',save(invoiceId,'invoice',inv.data,1))).status,400);
});
await test('Zahlungen müssen zur Rechnung passen; Stornieren gibt Stunden nachvollziehbar frei',async()=>{
 const paymentId=randomUUID(),data={studentId,date:'2026-10-12',amount:1000,notes:'Teilzahlung',invoiceId};
 assert.equal((await call('/api/records','POST',save(paymentId,'payment',data))).status,200);
 assert.equal((await call('/api/workflows','POST',{action:'void-invoice',id:invoiceId,version:1,reason:'Korrektur'})).status,400);
 assert.equal((await call('/api/records','POST',save(paymentId,'payment',{...data,invoiceId:undefined},1))).status,200);
 let r=await call('/api/workflows','POST',{action:'void-invoice',id:invoiceId,version:1,reason:'Korrektur'});assert.equal(r.status,200,JSON.stringify(await json(r)));
 const next=randomUUID();const simultaneous=await Promise.all([call('/api/workflows','POST',{action:'invoice',id:next,studentId,month:'2026-09',recipient:'Test Familie\nTeststraße 1'}),call('/api/workflows','POST',{action:'invoice',id:randomUUID(),studentId,month:'2026-09',recipient:'Test Familie\nTeststraße 1'})]);assert.equal(simultaneous.filter(r=>r.status===200).length,1);const winner=(await json(await call('/api/records'))).find(r=>r.kind==='invoice'&&r.data.status==='issued');
 assert.match((await json(await call('/api/records'))).find(r=>r.id===winner.id).data.number,/-000002$/);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'payment',data))).status,400);
 const cancellation=await call('/api/invoice?id='+invoiceId+'&storno=1');assert.equal(cancellation.status,200);const html=await cancellation.text();assert.match(html,/Stornorechnung/);assert.match(html,/-25,00/);assert.ok(!html.includes('Bitte bis')); 
 const inv=(await json(await call('/api/recovery'))).history.find(r=>r.recordId===invoiceId);assert.equal((await call('/api/recovery','POST',{action:'restore-history',id:inv.id,version:2})).status,409);
});
await test('Hausaufgaben verweigern fremde Materialien und ungültige Fälligkeit',async()=>{
 assert.equal((await call('/api/records','POST',save(randomUUID(),'homework',{studentId,title:'Test',instructions:'',due:'2026-02-30',status:'offen',fileIds:[]}))).status,400);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'homework',{studentId,title:'Test',instructions:'',due:'2026-10-20',status:'offen',fileIds:[randomUUID()]}))).status,400);
});
await test('Vollsicherung enthält Originalbytes und stellt sie mit Prüfsumme wieder her',async()=>{
 const form=new FormData();form.set('studentId',studentId);form.set('file',new Blob(['Vollständige Testdatei äöü']),'sicherung.txt');
 const upload=await json(await call('/api/files','POST',form));
 const result=await call('/api/backup');assert.equal(result.status,200);const tar=new Uint8Array(await result.arrayBuffer());
 let offset=0,manifest,bytes;while(offset<tar.length){const h=tar.slice(offset,offset+512);const name=new TextDecoder().decode(h.slice(0,100)).split('\0')[0];if(!name)break;const size=parseInt(new TextDecoder().decode(h.slice(124,136)).split('\0')[0],8);const body=tar.slice(offset+512,offset+512+size);if(name==='manifest.json')manifest=JSON.parse(new TextDecoder().decode(body));if(name==='files/'+upload.id)bytes=body;offset+=512+size+(512-size%512)%512;}
 assert.equal(new TextDecoder().decode(bytes),'Vollständige Testdatei äöü');assert.equal(manifest.fullArchive,true);
 await call('/api/files','POST',{action:'delete',id:upload.id});await call('/api/recovery','POST',{action:'purge-file',id:upload.id});
 const restore=new FormData();restore.set('metadata',JSON.stringify(manifest.files.find(f=>f.id===upload.id)));restore.set('file',new Blob([bytes]),'sicherung.txt');
 let res=await call('/api/backup','POST',restore);assert.equal(res.status,200,JSON.stringify(await json(res)));
 assert.equal(await (await call('/api/files?download='+upload.id)).text(),'Vollständige Testdatei äöü');
 assert.equal((await call('/api/backup','POST',restore,other)).status,403);
 const corrupt=new FormData();corrupt.set('metadata',JSON.stringify(manifest.files.find(f=>f.id===upload.id)));corrupt.set('file',new Blob(['wrong']),'sicherung.txt');assert.equal((await call('/api/backup','POST',corrupt)).status,400);
 const b=await mf.getR2Bucket('BUCKET');const date=new Date().toISOString().slice(0,10);await b.delete(`backups/${owner}/${date}.json`);
 await call('/api/records','POST',save(randomUUID(),'expense',{date:'2026-10-12',title:'Backup trigger',amount:1,notes:''}));
 await call('/api/files','POST',{action:'delete',id:upload.id});await call('/api/recovery','POST',{action:'purge-file',id:upload.id});
 res=await call('/api/backup','POST',{action:'restore-copies',date});const restored=await json(res);assert.equal(res.status,200);assert.equal(restored.missing.length,0);assert.equal(restored.restored,1);
 assert.equal(await (await call('/api/files?download='+upload.id)).text(),'Vollständige Testdatei äöü');
 // Disaster restore into an emptied isolated test database must rebuild invoice claims.
 await db.batch([db.prepare('DELETE FROM invoice_lines WHERE owner=?').bind(owner),db.prepare('DELETE FROM records WHERE owner=?').bind(owner)]);
 const recovered=await call('/api/recovery','POST',{action:'import',backup:manifest});assert.equal(recovered.status,200,JSON.stringify(await json(recovered)));
 const restoredInvoice=(await json(await call('/api/records'))).find(r=>r.kind==='invoice'&&r.data.status==='issued');assert.ok(restoredInvoice);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE owner=?').bind(owner).first()).n,restoredInvoice.data.lines.length);
});


const tutor1=randomUUID(),tutor2=randomUUID(),pupil1=randomUUID(),pupil2=randomUUID(),taught=randomUUID();let teachingFile;
await test('Teambeitritt ist persönlich, einmalig und bindet die stabile Benutzerkennung',async()=>{
 for(const [id,who,name] of [[tutor1,'teacher-one','Lehrkraft Eins'],[tutor2,'teacher-two','Lehrkraft Zwei']]){
 assert.equal((await call('/api/team','POST',{action:'save',id,version:0,data:{name,email:who+'@test.invalid',rate:1500,active:true}})).status,200);
 const d=await json(await call('/api/team','POST',{action:'invite',id}));const token=new URL(d.url).searchParams.get('token');
 assert.equal((await call('/api/team','POST',{action:'accept',token},'wrong-person')).status,403);
 assert.equal((await call('/api/team','POST',{action:'accept',token},who)).status,200);
 assert.equal((await call('/api/team','POST',{action:'accept',token},who)).status,403);
 }
 const ownerTeam=await json(await call('/api/team'));assert.equal(ownerTeam.role,'admin');assert.equal(ownerTeam.members.length,2);
 const teacher=await json(await call('/api/team','GET',undefined,'teacher-one'));assert.equal(teacher.role,'teacher');assert.equal(teacher.members.length,1);assert.equal(teacher.memberId,tutor1);
 assert.equal((await call('/api/team','POST',{action:'invite',id:tutor2},'teacher-one')).status,403);
});
await test('Lehrkräfte sehen nur zugewiesene Schüler und eigene Stunden ohne Schülerpreise',async()=>{
 for(const [id,name] of [[pupil1,'Erster Schüler'],[pupil2,'Zweiter Schüler']])assert.equal((await call('/api/records','POST',save(id,'student',{...student,name,billingAddress:'GEHEIME RECHNUNGSANSCHRIFT',rate:9900}))).status,200);
 let t=await json(await call('/api/team'));for(const id of [tutor1,tutor2])assert.equal((await call('/api/team','POST',{action:'assign',id,version:t.members.find(m=>m.id===id).version,studentIds:id===tutor1?[pupil1]:[pupil1,pupil2]})).status,200);
 const data={...lesson,studentId:pupil1,teacherId:tutor1,payRate:1500,status:'geplant',start:'2026-08-01T10:00:00.000Z'};assert.equal((await call('/api/records','POST',save(taught,'lesson',data))).status,200);
 const rows=await json(await call('/api/records','GET',undefined,'teacher-one'));assert.equal(rows.filter(r=>r.kind==='student').length,1);assert.equal(rows.find(r=>r.id===pupil1).data.rate,undefined);assert.equal(rows.find(r=>r.id===pupil1).data.billingAddress,undefined);assert.equal(rows.find(r=>r.id===taught).data.rate,undefined);assert.equal(rows.find(r=>r.id===taught).data.payRate,1500);assert.equal(rows.some(r=>['payment','invoice','expense','profile'].includes(r.kind)),false);
 const otherRows=await json(await call('/api/records','GET',undefined,'teacher-two'));assert.equal(otherRows.some(r=>r.id===taught),false);
 for(const path of ['/api/recovery','/api/backup','/api/invoice?id='+invoiceId])assert.equal((await call(path,'GET',undefined,'teacher-one')).status,403);
 assert.equal((await call('/api/records','POST',save(pupil1,'student',student,1),'teacher-one')).status,403);
 assert.equal((await call('/api/records','POST',save(taught,'lesson',data,1),'teacher-one')).status,403);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'homework',{studentId:pupil2,title:'Fremd',instructions:'',due:'2026-10-12',status:'offen',fileIds:[]}),'teacher-one')).status,403);
 assert.equal((await call('/api/workflows','POST',{action:'complete',id:taught,version:1,attendance:'anwesend',notes:''},'teacher-two')).status,403);
});
await test('Unterricht und Materialien dürfen nur innerhalb der aktuellen Zuordnung bearbeitet werden',async()=>{
 const f=new FormData();f.set('studentId',pupil1);f.set('file',new Blob(['Lehrkraftmaterial']),'material.txt');const upload=await call('/api/files','POST',f,'teacher-one');assert.equal(upload.status,201);teachingFile=(await json(upload)).id;
 assert.equal((await call('/api/files?download='+teachingFile,'GET',undefined,'teacher-one')).status,200);
 assert.equal((await call('/api/files','POST',{action:'delete',id:teachingFile},'teacher-one')).status,403);
 const bad=new FormData();bad.set('studentId',pupil2);bad.set('file',new Blob(['Fremd']),'material.txt');assert.equal((await call('/api/files','POST',bad,'teacher-one')).status,403);
 const complete=await call('/api/workflows','POST',{action:'complete',id:taught,version:1,attendance:'anwesend',notes:'Gemeinsam geübt',progress:{topic:'Addition',level:'sicher',correct:5,total:5,notes:'',next:''},homework:{title:'Übung',instructions:'Aufgabe 1',due:'2026-10-20',fileIds:[teachingFile]},payRate:999999},'teacher-one');assert.equal(complete.status,200,JSON.stringify(await json(complete)));
 const r=(await json(await call('/api/records'))).find(r=>r.id===taught);assert.equal(r.data.status,'gehalten');assert.equal(r.data.payRate,1500);
});
await test('Honorarabrechnungen nutzen gespeicherte Sätze und sperren doppelte Abrechnung',async()=>{
 let t=await json(await call('/api/team'));let m=t.members.find(m=>m.id===tutor1);await call('/api/team','POST',{action:'save',id:m.id,version:m.version,data:{...m,rate:2000,active:true}});
 const payrollId=randomUUID(),b={action:'payroll',id:payrollId,memberId:tutor1,month:'2026-08'};
 assert.equal((await call('/api/workflows','POST',b,'teacher-one')).status,403);
 assert.equal((await call('/api/workflows','POST',b)).status,200);assert.equal((await call('/api/workflows','POST',b)).status,200);assert.equal((await call('/api/workflows','POST',{...b,id:randomUUID()})).status,400);
 let list=await json(await call('/api/records'));const statement=list.find(r=>r.id===payrollId);assert.equal(statement.data.total,1500);
 const own=await json(await call('/api/records','GET',undefined,'teacher-one'));assert.equal(own.find(r=>r.id===payrollId).data.total,1500);
 assert.equal((await json(await call('/api/records','GET',undefined,'teacher-two'))).some(r=>r.id===payrollId),false);
 const l=list.find(r=>r.id===taught);assert.equal((await call('/api/records','POST',save(l.id,'lesson',{...l.data,minutes:90},l.version))).status,409);
 assert.equal((await call('/api/workflows','POST',{action:'payroll-status',id:payrollId,version:1,status:'bezahlt',note:'Testüberweisung'})).status,200);
 assert.equal((await call('/api/workflows','POST',{action:'payroll-status',id:payrollId,version:1,status:'bezahlt',note:''})).status,409);
});
await test('Zuordnungsentzug und Deaktivierung sperren vorhandene Lehrkräftezugänge',async()=>{
 let t=await json(await call('/api/team'));let m=t.members.find(m=>m.id===tutor1);assert.equal((await call('/api/team','POST',{action:'assign',id:m.id,version:m.version,studentIds:[]})).status,200);
 assert.equal((await call('/api/files?download='+teachingFile,'GET',undefined,'teacher-one')).status,404);
 const rows=await json(await call('/api/records','GET',undefined,'teacher-one'));assert.equal(rows.some(r=>r.kind==='student'||r.kind==='lesson'),false);
 t=await json(await call('/api/team'));m=t.members.find(m=>m.id===tutor1);assert.equal((await call('/api/team','POST',{action:'save',id:m.id,version:m.version,data:{name:m.name,email:m.email,rate:m.rate,active:false}})).status,200);
 assert.equal((await call('/api/records','GET',undefined,'teacher-one')).status,403);assert.equal((await call('/api/team','GET',undefined,'teacher-one')).status,403);
});
await test('Team-Sicherung enthält keine aktiven Sitzungen oder Einladungstoken und stellt gesperrte Profile wieder her',async()=>{
 const records=await json(await call('/api/records'));const members=(await db.prepare('SELECT id,name,email,rate FROM team_members WHERE owner=?').bind(owner).all()).results;
 const assignments=(await db.prepare('SELECT student_id,member_id FROM student_assignments WHERE owner=?').bind(owner).all()).results;
 const tar=new Uint8Array(await (await call('/api/backup')).arrayBuffer());const manifestSize=parseInt(new TextDecoder().decode(tar.slice(124,136)).split('\0')[0],8);const backup=JSON.parse(new TextDecoder().decode(tar.slice(512,512+manifestSize)));assert.equal(backup.members.length,2);assert.ok(backup.members.every(m=>m.user_id===undefined&&m.invite_hash===undefined));await db.batch([db.prepare('DELETE FROM payroll_claims'),db.prepare('DELETE FROM invoice_lines'),db.prepare('DELETE FROM student_assignments'),db.prepare('DELETE FROM team_members'),db.prepare('DELETE FROM records WHERE owner=?').bind(owner)]);
 const r=await call('/api/recovery','POST',{action:'import',backup});assert.equal(r.status,200,JSON.stringify(await json(r)));
 const restored=(await db.prepare('SELECT active,user_id,invite_hash FROM team_members').all()).results;assert.equal(restored.length,2);assert.ok(restored.every(m=>m.active===0&&m.user_id===null&&m.invite_hash===null));
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM payroll_claims').first()).n,1);
});

await test('Hausaufgaben-Uploads bleiben in Materialien und Lösungen sind schülergebunden',async()=>{
 const pupil=randomUUID(),foreignPupil=randomUUID();
 assert.equal((await call('/api/records','POST',save(pupil,'student',{...student,name:'Aufgaben Schüler'}))).status,200);
 assert.equal((await call('/api/records','POST',save(foreignPupil,'student',{...student,name:'Anderer Schüler'}))).status,200);
 async function uploadFor(id,name){const f=new FormData();f.set('studentId',id);f.set('file',new Blob(['Übung und Lösungsweg']),name);const r=await call('/api/files','POST',f);assert.equal(r.status,201);return (await json(r)).id;}
 const material=await uploadFor(pupil,'aufgabe.txt'),solution=await uploadFor(pupil,'loesung.txt'),foreign=await uploadFor(foreignPupil,'fremd.txt');
 const hw={studentId:pupil,title:'Brüche üben',instructions:'Aufgabe 1',due:'2026-10-20',status:'offen',fileIds:[material],solution:'1/2 + 1/2 = 1',solutionFileIds:[solution]};const id=randomUUID();
 assert.equal((await call('/api/records','POST',save(id,'homework',hw))).status,200);
 let rows=await json(await call('/api/records'));const saved=rows.find(r=>r.id===id).data;assert.deepEqual(saved.fileIds,[material]);assert.deepEqual(saved.solutionFileIds,[solution]);assert.equal(saved.solution,hw.solution);
 const materials=await json(await call('/api/files'));assert.ok(materials.some(f=>f.id===material&&f.studentId===pupil));assert.ok(materials.some(f=>f.id===solution&&f.studentId===pupil));
 assert.equal((await call('/api/records','POST',save(id,'homework',{...hw,solutionFileIds:[foreign]},1))).status,400);
 assert.equal((await call('/api/records','POST',save(id,'homework',{...hw,solutionFileIds:[randomUUID()]},1))).status,400);
 assert.equal((await call('/api/records','POST',save(id,'homework',{...hw,solutionFileIds:Array(21).fill(solution)},1))).status,400);
 const lessonId=randomUUID();assert.equal((await call('/api/records','POST',save(lessonId,'lesson',{...lesson,studentId:pupil,start:'2024-01-01T12:00:00.000Z',status:'geplant'}))).status,200);
 const body={action:'complete',id:lessonId,version:1,attendance:'anwesend',notes:'',homework:{...hw,solutionFileIds:[foreign]}};
 assert.equal((await call('/api/workflows','POST',body)).status,400);
 rows=await json(await call('/api/records'));assert.equal(rows.find(r=>r.id===lessonId).data.status,'geplant');
 assert.equal((await call('/api/workflows','POST',{...body,homework:hw})).status,200);
 rows=await json(await call('/api/records'));const assigned=rows.find(r=>r.kind==='homework'&&r.data.lessonId===lessonId);assert.equal(assigned.data.solution,hw.solution);assert.deepEqual(assigned.data.solutionFileIds,[solution]);
});

const groupId=randomUUID(),groupTutor=randomUUID(),groupPupils=[randomUUID(),randomUUID(),randomUUID()],groupSession=randomUUID();let groupLessons=[];
await test('Gruppen planen Teilnehmer atomar, prüfen Lehrkraft und vermeiden Doppelbuchungen',async()=>{
 for(const [i,id] of groupPupils.entries())assert.equal((await call('/api/records','POST',save(id,'student',{...student,name:'Gruppenschüler '+i}))).status,200);
 assert.equal((await call('/api/team','POST',{action:'save',id:groupTutor,version:0,data:{name:'Gruppenlehrkraft',email:'group-teacher@test.invalid',rate:3000,active:true}})).status,200);
 const group={name:'Mathegruppe',subject:'Mathematik',studentIds:groupPupils,teacherId:groupTutor,rate:1200,goal:'Brüche',active:true};
 assert.equal((await call('/api/records','POST',save(groupId,'group',group))).status,400);
 let member=(await json(await call('/api/team'))).members.find(m=>m.id===groupTutor);assert.equal((await call('/api/team','POST',{action:'assign',id:groupTutor,version:member.version,studentIds:groupPupils})).status,200);
 assert.equal((await call('/api/records','POST',save(groupId,'group',group))).status,200);
 const invitation=await json(await call('/api/team','POST',{action:'invite',id:groupTutor}));assert.equal((await call('/api/team','POST',{action:'accept',token:new URL(invitation.url).searchParams.get('token')},'group-teacher')).status,200);
 const own=await json(await call('/api/records','GET',undefined,'group-teacher'));assert.equal(own.find(r=>r.id===groupId).data.rate,undefined);
 const body={action:'group-session',id:groupSession,groupId,start:'2024-02-12T12:00:00.000Z',minutes:90,payRate:3000,location:'Raum 1'};
 const result=await call('/api/workflows','POST',body);assert.equal(result.status,200,JSON.stringify(await json(result)));
 assert.equal((await call('/api/workflows','POST',body)).status,200);
 groupLessons=(await json(await call('/api/records'))).filter(r=>r.data.groupSessionId===groupSession);assert.equal(groupLessons.length,3);assert.ok(groupLessons.every(r=>r.data.rate===1200&&r.data.payRate===3000));
 assert.equal((await call('/api/workflows','POST',{...body,id:randomUUID()})).status,409);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'lesson',{...lesson,studentId:groupPupils[0],start:body.start,status:'geplant'}))).status,409);
 assert.equal((await call('/api/records','POST',save(groupLessons[0].id,'lesson',{...groupLessons[0].data,start:'2024-02-12T13:00:00.000Z'},1))).status,400);
 assert.equal((await call('/api/workflows','POST',{...body,id:randomUUID()},'group-teacher')).status,403);
});
await test('Gruppenanwesenheit rechnet Schüler einzeln und Lehrkräftehonorar genau einmal ab',async()=>{
 const payrollId=randomUUID();
 for(const [i,r] of groupLessons.entries()){
 assert.equal((await call('/api/workflows','POST',{action:'complete',id:r.id,version:1,attendance:i===2?'nicht erschienen':'anwesend',notes:'Gruppenunterricht'},'group-teacher')).status,200);
 if(i<2)assert.equal((await call('/api/workflows','POST',{action:'payroll',id:payrollId,memberId:groupTutor,month:'2024-02'})).status,400);
 }
 assert.equal((await call('/api/workflows','POST',{action:'payroll',id:payrollId,memberId:groupTutor,month:'2024-02'})).status,200);
 let rows=await json(await call('/api/records'));const payroll=rows.find(r=>r.id===payrollId);assert.equal(payroll.data.total,4500);assert.equal(payroll.data.lines.length,2);assert.equal(payroll.data.lines.filter(l=>l.amount>0).length,1);
 assert.equal((await call('/api/workflows','POST',{action:'payroll',id:randomUUID(),memberId:groupTutor,month:'2024-02'})).status,400);
 for(const [i,l] of groupLessons.entries()){const invoiceId=randomUUID();const r=await call('/api/workflows','POST',{action:'invoice',id:invoiceId,studentId:l.data.studentId,month:'2024-02',recipient:'Testkunde Musterstraße 1'});assert.equal(r.status,i===2?400:200);if(i<2){rows=await json(await call('/api/records'));assert.equal(rows.find(r=>r.id===invoiceId).data.gross,1800);}}
 assert.equal((await call('/api/workflows','POST',{action:'cancel-group-session',id:groupSession})).status,400);
});
await test('Gruppenänderungen erhalten geplante Teilnehmer; gemeinsame Absage bleibt atomar',async()=>{
 let rows=await json(await call('/api/records'));let group=rows.find(r=>r.id===groupId);const id=randomUUID();
 assert.equal((await call('/api/workflows','POST',{action:'group-session',id,groupId,start:'2024-02-19T12:00:00.000Z',minutes:60,payRate:3000,location:''})).status,200);
 assert.equal((await call('/api/records','POST',save(groupId,'group',{...group.data,studentIds:groupPupils.slice(0,2),rate:1500},group.version))).status,200);
 rows=await json(await call('/api/records'));assert.equal(rows.filter(r=>r.data.groupSessionId===id).length,3);assert.ok(rows.filter(r=>r.data.groupSessionId===id).every(r=>r.data.rate===1200));
 assert.equal((await call('/api/workflows','POST',{action:'cancel-group-session',id})).status,200);
 rows=await json(await call('/api/records'));assert.ok(rows.filter(r=>r.data.groupSessionId===id).every(r=>r.data.status==='abgesagt'));
 const tar=new Uint8Array(await (await call('/api/backup')).arrayBuffer());const size=parseInt(new TextDecoder().decode(tar.slice(124,136)).split('\0')[0],8);const backup=JSON.parse(new TextDecoder().decode(tar.slice(512,512+size)));assert.ok(backup.records.some(r=>r.kind==='group'&&r.id===groupId));assert.equal(backup.records.filter(r=>r.data.groupSessionId===id).length,3);
 assert.equal((await call('/api/recovery','POST',{action:'import',backup})).status,200);
 const invalid={...backup,records:[{id:randomUUID(),kind:'group',data:{...group.data,studentIds:[randomUUID(),randomUUID()]}}]};assert.equal((await call('/api/recovery','POST',{action:'import',backup:invalid})).status,400);
});

await test('Entfernte Kalenderanbindung liefert weder Termine noch neue Links',async()=>{
 const token='a'.repeat(64);
 for(const who of [null,owner,other])for(const path of ['/api/calendar','/api/calendar/feed?token='+token]){
  const response=await call(path,'GET',undefined,who);assert.equal(response.status,410);assert.ok(!(await response.text()).includes('BEGIN:VCALENDAR'));
  assert.equal((await call(path,'POST',{action:'create'},who)).status,410);
 }
});


const accountBuild=await build({entryPoints:['lib/accounting.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {accounting,invoiceStatus}=await import('data:text/javascript;base64,'+Buffer.from(accountBuild.outputFiles[0].text).toString('base64'));
const accountStudent=randomUUID();let firstInvoice,secondInvoice,creditPayment;const fixtureInvoice=async(sid,rate,month)=>{
 const lid=randomUUID(),iid=randomUUID();assert.equal((await call('/api/records','POST',save(lid,'lesson',{...lesson,studentId:sid,rate,minutes:60,start:month+'-05T12:00:00.000Z'}))).status,200);
 const response=await call('/api/workflows','POST',{action:'invoice',id:iid,studentId:sid,month,recipient:'Test Empfänger, Musterweg 1'});assert.equal(response.status,200,JSON.stringify(await json(response)));return iid;
};
await test('Schülerkonto: 100 Euro Eingang, 80 Euro Rechnung, 20 Euro Guthaben, keine Doppelzählung',async()=>{
 assert.equal((await call('/api/records','POST',save(accountStudent,'student',student))).status,200);
 firstInvoice=await fixtureInvoice(accountStudent,8000,'2027-01');
 for(const [rate,status] of [[4000,'gehalten'],[0,'gehalten'],[6000,'geplant']])assert.equal((await call('/api/records','POST',save(randomUUID(),'lesson',{...lesson,studentId:accountStudent,start:'2027-02-05T12:00:00.000Z',rate,status}))).status,200);
 creditPayment=randomUUID();const data={studentId:accountStudent,date:'2026-10-15',amount:10000,method:'Überweisung',notes:'Vorauszahlung',allocations:[{invoiceId:firstInvoice,amount:8000}]};
 assert.equal((await call('/api/records','POST',save(creditPayment,'payment',data))).status,200);
 let rows=await json(await call('/api/records')),a=accounting(rows).accounts.find(a=>a.student.id===accountStudent);assert.deepEqual([a.paid,a.open,a.credit,a.unbilled],[10000,0,2000,4000]);assert.equal(a.pending.filter(l=>l.data.rate===0).length,1);
 secondInvoice=randomUUID();assert.equal((await call('/api/workflows','POST',{action:'invoice',id:secondInvoice,studentId:accountStudent,month:'2027-02',recipient:'Test Empfänger, Musterweg 1'})).status,200);
 assert.equal((await call('/api/records','POST',save(creditPayment,'payment',{...data,allocations:[...data.allocations,{invoiceId:secondInvoice,amount:2000}]},1))).status,200);
 rows=await json(await call('/api/records'));const ledger=accounting(rows);a=ledger.accounts.find(a=>a.student.id===accountStudent);assert.deepEqual([a.paid,a.open,a.credit,a.unbilled],[10000,2000,0,0]);assert.equal(invoiceStatus(rows.find(r=>r.id===secondInvoice),2000,'2026-01-01'),'Teilbezahlt');assert.equal(invoiceStatus(rows.find(r=>r.id===secondInvoice),2000,'2099-01-01'),'Überfällig');
 assert.equal((await call('/api/workflows','POST',{action:'void-invoice',id:firstInvoice,version:1,reason:'Korrektur'})).status,400);
});
await test('Zahlungszuordnungen: Überschreitung, Duplikate, fremde Schüler und veraltete Bearbeitung gesperrt',async()=>{
 const base={studentId:accountStudent,date:'2026-10-15',amount:2000,notes:'',method:'PayPal'};
 for(const allocations of [[{invoiceId:secondInvoice,amount:2001}],[{invoiceId:secondInvoice,amount:500},{invoiceId:secondInvoice,amount:500}]])assert.equal((await call('/api/records','POST',save(randomUUID(),'payment',{...base,allocations}))).status,400);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'payment',{...base,studentId,allocations:[{invoiceId:secondInvoice,amount:100}]}))).status,400);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'payment',{...base,allocations:[{invoiceId:firstInvoice,amount:100}]}))).status,409);
 assert.equal((await call('/api/records','POST',save(creditPayment,'payment',{...base,allocations:[]},1))).status,409);
 const current=(await json(await call('/api/records'))).find(r=>r.id===creditPayment);assert.equal((await call('/api/records','POST',save(creditPayment,'payment',{...current.data,amount:9999},current.version))).status,400);
 const latest=(await json(await call('/api/records'))).find(r=>r.id===creditPayment);assert.equal(latest.data.amount,10000);assert.equal(latest.version,current.version);
});
await test('Gleichzeitige Zuordnungen und Wiederherstellung können Rechnungen nicht überzahlen',async()=>{
 const ids=[randomUUID(),randomUUID()],data={studentId:accountStudent,date:'2026-10-15',amount:2000,notes:'Restzahlung',method:'Bar',allocations:[{invoiceId:secondInvoice,amount:2000}]};
 const results=await Promise.all(ids.map(id=>call('/api/records','POST',save(id,'payment',data))));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const winner=ids[results.findIndex(r=>r.status===200)];assert.equal((await call('/api/records','POST',{action:'delete',kind:'payment',id:winner,version:1})).status,200);
 const replacement=randomUUID();assert.equal((await call('/api/records','POST',save(replacement,'payment',data))).status,200);
 assert.equal((await call('/api/recovery','POST',{action:'restore-record',id:winner,version:2})).status,409);
 assert.equal((await call('/api/recovery','POST',{action:'import',backup:{format:'jus-lernraum-v2',records:[{id:winner,kind:'payment',data}]}})).status,409);
 let rows=await json(await call('/api/records'));assert.ok(!rows.some(r=>r.id===winner));assert.equal(accounting(rows).accounts.find(a=>a.student.id===accountStudent).open,0);
 assert.equal((await call('/api/records','POST',{action:'delete',kind:'payment',id:replacement,version:1})).status,200);
 assert.equal((await call('/api/recovery','POST',{action:'restore-record',id:winner,version:2})).status,200);
 const response=await call('/api/backup');const tar=new Uint8Array(await response.arrayBuffer());const length=parseInt(new TextDecoder().decode(tar.slice(124,136)).split('\0')[0],8);const backup=JSON.parse(new TextDecoder().decode(tar.slice(512,512+length)));assert.deepEqual(backup.records.find(r=>r.id===creditPayment).data.allocations,[{invoiceId:firstInvoice,amount:8000},{invoiceId:secondInvoice,amount:2000}]);
});
await test('Alte Überzahlungen werden als Euro-Guthaben erhalten und können weiterverwendet werden',async()=>{
 const sid=randomUUID();assert.equal((await call('/api/records','POST',save(sid,'student',student))).status,200);const iid=await fixtureInvoice(sid,8000,'2027-03');const pid=randomUUID();
 const old={studentId:sid,date:'2026-10-15',amount:10000,invoiceId:iid,notes:'Alte Zahlung'};assert.equal((await call('/api/records','POST',save(pid,'payment',old))).status,200);
 let rows=await json(await call('/api/records'));let a=accounting(rows).accounts.find(a=>a.student.id===sid);assert.deepEqual([a.paid,a.open,a.credit],[10000,0,2000]);assert.equal(rows.find(r=>r.id===pid).data.invoiceId,iid);
 const next=await fixtureInvoice(sid,2000,'2027-04');assert.equal((await call('/api/records','POST',save(pid,'payment',{...old,invoiceId:undefined,allocations:[{invoiceId:iid,amount:8000},{invoiceId:next,amount:2000}]},1))).status,200);
 rows=await json(await call('/api/records'));a=accounting(rows).accounts.find(a=>a.student.id===sid);assert.deepEqual([a.paid,a.open,a.credit],[10000,0,0]);
 const payment=rows.find(r=>r.id===pid);assert.equal((await call('/api/records','POST',save(pid,'payment',{...payment.data,allocations:[]},payment.version))).status,200);
 assert.equal((await call('/api/workflows','POST',{action:'void-invoice',id:iid,version:1,reason:'Korrektur'})).status,200);
 rows=await json(await call('/api/records'));a=accounting(rows).accounts.find(a=>a.student.id===sid);assert.deepEqual([a.paid,a.open,a.credit,a.unbilled],[10000,2000,10000,8000]);
});

// Teacher scheduling uses a dedicated allowlisted workflow, never financial client fields.
const schedulingTeacher=randomUUID(),schedulingPupil=randomUUID(),schedulingOther=randomUUID(),schedulingActor='teacher-scheduler';
const schedulingId=randomUUID();
const scheduleBody=(overrides={})=>({action:'teacher-schedule',id:schedulingId,version:0,studentId:schedulingPupil,subject:'Mathematik',start:'2032-01-12T10:00:00.000Z',minutes:60,location:'Online',notes:'Vereinbart',...overrides});
await test('Lehrkraft plant eigene Einzeltermine mit serverseitigen Preisen und geschützten Honoraren',async()=>{
 for(const id of [schedulingPupil,schedulingOther])assert.equal((await call('/api/records','POST',save(id,'student',{...student,rate:4200}))).status,200);
 assert.equal((await call('/api/team','POST',{action:'save',id:schedulingTeacher,version:0,data:{name:'Planung',email:schedulingActor+'@test.invalid',rate:1800,active:true}})).status,200);
 const invite=await json(await call('/api/team','POST',{action:'invite',id:schedulingTeacher}));assert.equal((await call('/api/team','POST',{action:'accept',token:new URL(invite.url).searchParams.get('token')},schedulingActor)).status,200);
 let team=await json(await call('/api/team'));assert.equal((await call('/api/team','POST',{action:'assign',id:schedulingTeacher,version:team.members.find(m=>m.id===schedulingTeacher).version,studentIds:[schedulingPupil]})).status,200);
 let response=await call('/api/workflows','POST',scheduleBody(),schedulingActor);assert.equal(response.status,200,JSON.stringify(await json(response)));
 let rows=await json(await call('/api/records'));let created=rows.find(r=>r.id===schedulingId);assert.equal(created.data.rate,4200);assert.equal(created.data.payRate,1800);assert.equal(created.data.teacherId,schedulingTeacher);assert.equal(created.data.status,'geplant');
 const visible=await json(await call('/api/records','GET',undefined,schedulingActor));assert.equal(visible.find(r=>r.id===schedulingId).data.rate,undefined);
 // Later default changes must not change the existing appointment's agreed rates.
 await call('/api/records','POST',save(schedulingPupil,'student',{...student,rate:9900},1));team=await json(await call('/api/team'));const m=team.members.find(m=>m.id===schedulingTeacher);await call('/api/team','POST',{action:'save',id:m.id,version:m.version,data:{...m,rate:2700,active:true}});
 response=await call('/api/workflows','POST',scheduleBody({version:1,start:'2032-01-13T10:00:00.000Z',minutes:90}),schedulingActor);assert.equal(response.status,200,JSON.stringify(await json(response)));
 rows=await json(await call('/api/records'));created=rows.find(r=>r.id===schedulingId);assert.equal(created.data.rate,4200);assert.equal(created.data.payRate,1800);assert.equal(created.version,2);assert.equal(created.data.minutes,90);
 assert.equal((await call('/api/workflows','POST',scheduleBody({version:1}),schedulingActor)).status,409);
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),start:'2032-01-14T10:00:00.000Z'}),schedulingActor)).status,200);
 rows=await json(await call('/api/records'));created=rows.find(r=>r.kind==='lesson'&&r.data.studentId===schedulingPupil&&r.data.start==='2032-01-14T10:00:00.000Z');assert.equal(created.data.rate,9900);assert.equal(created.data.payRate,2700);
});
await test('Lehrkräfteplanung verweigert fremde Daten, Preisfelder, Gruppen und zukünftige gehaltene Stunden',async()=>{
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),studentId:schedulingOther}),schedulingActor)).status,403);
 for(const field of ['rate','payRate','teacherId','status','groupId','groupSessionId','seriesId','attendance'])assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),[field]:999}),schedulingActor)).status,400,field);
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),start:'2020-01-01T10:00:00.000Z'}),schedulingActor)).status,400);
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),minutes:0}),schedulingActor)).status,400);
 assert.equal((await call('/api/workflows','POST',scheduleBody(),null)).status,401);
 assert.equal((await call('/api/workflows','POST',scheduleBody(),schedulingActor,'https://foreign.invalid')).status,403);
 const foreignId=randomUUID();assert.equal((await call('/api/records','POST',save(foreignId,'lesson',{...lesson,studentId:schedulingPupil,status:'geplant',start:'2033-01-01T10:00:00.000Z'}))).status,200);
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:foreignId,version:1}),schedulingActor)).status,403);
 const heldId=randomUUID();assert.equal((await call('/api/records','POST',save(heldId,'lesson',{...lesson,studentId:schedulingPupil,teacherId:schedulingTeacher,payRate:1800}))).status,200);
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:heldId,version:1}),schedulingActor)).status,400);
 // Fixture represents an existing group child; this endpoint must never split the session.
 const groupChild=randomUUID();await db.prepare('INSERT INTO records(id,owner,kind,data,version,updated) VALUES(?,?,?,?,1,?)').bind(groupChild,owner,'lesson',JSON.stringify({...lesson,studentId:schedulingPupil,teacherId:schedulingTeacher,payRate:1800,status:'geplant',groupSessionId:randomUUID()}),new Date().toISOString()).run();
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:groupChild,version:1}),schedulingActor)).status,400);
 assert.equal((await call('/api/records','POST',save(randomUUID(),'lesson',lesson),schedulingActor)).status,403);
});
await test('Überschneidungen und parallele Terminbuchungen werden atomar verhindert',async()=>{
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),start:'2032-01-13T10:30:00.000Z'}),schedulingActor)).status,409);
 const ids=[randomUUID(),randomUUID()];const responses=await Promise.all(ids.map(id=>call('/api/workflows','POST',scheduleBody({id,start:'2032-02-01T10:00:00.000Z'}),schedulingActor)));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const rows=await json(await call('/api/records'));assert.equal(rows.filter(r=>ids.includes(r.id)).length,1);
 // Adjacent appointments are allowed, and a failed move leaves the original intact.
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),start:'2032-02-01T11:00:00.000Z'}),schedulingActor)).status,200);
 assert.equal((await call('/api/workflows','POST',scheduleBody({version:2,start:'2032-02-01T10:00:00.000Z'}),schedulingActor)).status,409);
 assert.equal((await json(await call('/api/records'))).find(r=>r.id===schedulingId).data.start,'2032-01-13T10:00:00.000Z');
 // Also reject student conflicts when the appointment belongs to the owner.
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID(),start:'2033-01-01T10:00:00.000Z'}),schedulingActor)).status,409);
});
await test('Lehrkraft korrigiert gehaltene Stunden ohne Status- oder Preisänderung; Abrechnungen bleiben gesperrt',async()=>{
 const id=randomUUID(),base={...lesson,studentId:schedulingPupil,teacherId:schedulingTeacher,payRate:1800,start:'2025-03-12T10:00:00.000Z',attendance:'anwesend'};
 assert.equal((await call('/api/records','POST',save(id,'lesson',base))).status,200);
 const edit=scheduleBody({id,version:1,start:'2025-03-12T10:00:00.000Z',minutes:90,notes:'Korrigiertes Protokoll'});
 let r=await call('/api/workflows','POST',edit,schedulingActor);assert.equal(r.status,200,JSON.stringify(await json(r)));
 let rows=await json(await call('/api/records'));let row=rows.find(r=>r.id===id);assert.equal(row.data.status,'gehalten');assert.equal(row.data.attendance,'anwesend');assert.equal(row.data.rate,base.rate);assert.equal(row.data.payRate,1800);assert.equal(row.data.minutes,90);assert.equal(row.data.notes,'Korrigiertes Protokoll');
 assert.equal((await call('/api/workflows','POST',edit,schedulingActor)).status,409);
 assert.equal((await call('/api/workflows','POST',{...edit,version:2,start:'2039-01-01T10:00:00.000Z'},schedulingActor)).status,400);
 assert.equal((await call('/api/workflows','POST',{...edit,version:2,status:'geplant'},schedulingActor)).status,400);
 const invoice=randomUUID();r=await call('/api/workflows','POST',{action:'invoice',id:invoice,studentId:schedulingPupil,month:'2025-03',recipient:'Test Rechnungsempfänger'});assert.equal(r.status,200,JSON.stringify(await json(r)));
 r=await call('/api/workflows','POST',{...edit,version:2,minutes:120},schedulingActor);assert.equal(r.status,409);assert.match((await json(r)).error,/Abrechnung|abrechnung/);
 assert.equal((await call('/api/workflows','POST',{action:'void-invoice',id:invoice,version:1,reason:'Testkorrektur'})).status,200);
 const payroll=randomUUID();r=await call('/api/workflows','POST',{action:'payroll',id:payroll,memberId:schedulingTeacher,month:'2025-03'});assert.equal(r.status,200,JSON.stringify(await json(r)));
 assert.equal((await call('/api/workflows','POST',{...edit,version:2,minutes:120},schedulingActor)).status,409);
 row=(await json(await call('/api/records'))).find(r=>r.id===id);assert.equal(row.version,2);assert.equal(row.data.minutes,90);
});

await test('Archivierte Schüler, entzogene Zuordnungen und deaktivierte Lehrkräfte dürfen nicht planen',async()=>{
 const pupil=(await json(await call('/api/records'))).find(r=>r.id===schedulingPupil);
 await call('/api/records','POST',save(pupil.id,'student',{...pupil.data,active:false},pupil.version));
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID()}),schedulingActor)).status,400);
 await call('/api/records','POST',save(pupil.id,'student',{...pupil.data,active:true},pupil.version+1));
 let team=await json(await call('/api/team'));let m=team.members.find(m=>m.id===schedulingTeacher);
 await call('/api/team','POST',{action:'assign',id:m.id,version:m.version,studentIds:[]});
 assert.equal((await call('/api/workflows','POST',scheduleBody({version:2}),schedulingActor)).status,403);
 team=await json(await call('/api/team'));m=team.members.find(m=>m.id===schedulingTeacher);
 await call('/api/team','POST',{action:'save',id:m.id,version:m.version,data:{...m,active:false}});
 assert.equal((await call('/api/workflows','POST',scheduleBody({id:randomUUID()}),schedulingActor)).status,403);
});

await test('Vollsicherung repariert fehlende Originalbytes auch bei vorhandenem Papierkorbeintrag',async()=>{
 const form=new FormData();form.set('studentId',studentId);form.set('file',new Blob(['Wiederherstellungsprobe']),'probe.txt');
 const upload=await json(await call('/api/files','POST',form));
 const meta=await db.prepare('SELECT * FROM files WHERE id=?').bind(upload.id).first();
 assert.equal((await call('/api/files','POST',{action:'delete',id:upload.id})).status,200);
 await (await mf.getR2Bucket('BUCKET')).delete(meta.object_key);
 const restore=new FormData();restore.set('metadata',JSON.stringify(meta));restore.set('file',new Blob(['Wiederherstellungsprobe']),'probe.txt');
 assert.equal((await call('/api/backup','POST',restore)).status,200);
 const download=await call('/api/files?download='+upload.id);assert.equal(download.status,200);assert.equal(await download.text(),'Wiederherstellungsprobe');
 assert.equal((await call('/api/backup','POST',restore)).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM files WHERE id=?').bind(upload.id).first()).n,1);
});
await test('Leere Schülersicherung stellt Lehrkräfteprofile gesperrt wieder her',async()=>{
 const id=randomUUID();const backup={format:'jus-lernraum-v2',records:[],members:[{id,name:'Restore Tutor',email:'restore-only@test.invalid',rate:1700}],assignments:[]};
 assert.equal((await call('/api/recovery','POST',{action:'import',backup})).status,200);
 const member=await db.prepare('SELECT * FROM team_members WHERE id=?').bind(id).first();assert.ok(member);assert.equal(member.active,0);assert.equal(member.user_id,null);
 assert.equal((await call('/api/recovery','POST',{action:'import',backup})).status,200);
});
await test('Direkte API-Zugriffe schützen Sicherungen und Finanzdaten vor Lehrkräften und Gästen',async()=>{
 for(const path of ['/api/records','/api/files','/api/recovery','/api/backup','/api/invoice','/api/team']){
  assert.equal((await call(path,'GET',undefined,null)).status,401,path);
  assert.equal((await call(path,'GET',undefined,'uninvited-person')).status,403,path);
 }
 for(const path of ['/api/recovery','/api/backup','/api/invoice'])assert.equal((await call(path,'GET',undefined,'teacher-two')).status,403,path);
 for(const path of ['/api/records','/api/files','/api/recovery','/api/backup','/api/team','/api/workflows']){
  assert.equal((await call(path,'POST',{},null)).status,401,path);
  assert.equal((await call(path,'POST',{},owner,'https://foreign.invalid')).status,403,path);
 }
});
await test('Notfallimport erhält Finanzdaten und baut Rechnungs- und Honoraransprüche wieder auf',async()=>{
 const before=await json(await call('/api/records'));
 const claims=await db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE owner=?').bind(owner).first();
 const payroll=await db.prepare('SELECT COUNT(*) AS n FROM payroll_claims WHERE owner=?').bind(owner).first();
 assert.ok(claims.n>0);assert.ok(payroll.n>0);assert.ok(before.some(r=>r.kind==='payment'));
 // Destructive simulation ONLY in this suite's isolated Miniflare database.
 await db.batch([db.prepare('DELETE FROM invoice_lines WHERE owner=?').bind(owner),db.prepare('DELETE FROM payroll_claims WHERE owner=?').bind(owner),db.prepare('DELETE FROM records WHERE owner=?').bind(owner)]);
 const response=await call('/api/recovery','POST',{action:'import',backup:{format:'jus-lernraum-v2',records:before}});
 assert.equal(response.status,200,JSON.stringify(await json(response)));
 const after=await json(await call('/api/records'));
 const contents=rows=>rows.map(r=>({id:r.id,kind:r.kind,data:r.data})).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(contents(after),contents(before));
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM invoice_lines WHERE owner=?').bind(owner).first()).n,claims.n);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM payroll_claims WHERE owner=?').bind(owner).first()).n,payroll.n);
 const balances=rows=>accounting(rows).accounts.map(a=>({id:a.student.id,paid:a.paid,credit:a.credit,open:a.open,unbilled:a.unbilled})).sort((a,b)=>a.id.localeCompare(b.id));
 assert.deepEqual(balances(after),balances(before));
});
}finally{await mf.dispose();}
