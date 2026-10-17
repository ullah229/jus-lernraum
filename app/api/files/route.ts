import {canStudent,teamGuards} from '@/lib/team';
import { access,out,database,bucket,boundedBody,jsonBody,validId,failure,snapshot } from '@/lib/server-data';
import {inspectFile,MAX_FILE_SIZE} from '@/lib/file-policy';
export const dynamic='force-dynamic';
export async function GET(req:Request){const a=await access();if(a.error)return a.error;try{const db=database(),url=new URL(req.url),id=url.searchParams.get('download');
 if(id){if(!validId(id))return out({error:'Ungültige Datei.'},400);const f=await db.prepare('SELECT * FROM files WHERE id=? AND owner=? AND deleted IS NULL').bind(id,a.owner).first<any>();if(!f||!canStudent(a,f.student_id))return out({error:'Datei nicht gefunden.'},404);const object=await bucket().get(f.object_key);if(!object)return out({error:'Datei ist derzeit nicht verfügbar.'},503);return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Length':String(f.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});}
 const list=await db.prepare('SELECT id,student_id AS studentId,name,mime,size,created FROM files WHERE owner=? AND deleted IS NULL ORDER BY created DESC').bind(a.owner).all();return out(list.results.filter((f:any)=>canStudent(a,f.studentId)));
 }catch(e){return failure(e);}}
export async function POST(req:Request){const a=await access(req);if(a.error)return a.error;let uploadedKey:string|undefined;try{
 if(req.headers.get('content-type')?.startsWith('application/json')){if(a.role!=='admin')return out({error:'Dateien löschen darf nur der Inhaber.'},403);const b=await jsonBody(req);if(b.action!=='delete'||!validId(b.id))return out({error:'Ungültige Anfrage.'},400);await snapshot(a.owner!);const r=await database().prepare('UPDATE files SET deleted=? WHERE id=? AND owner=? AND deleted IS NULL').bind(new Date().toISOString(),b.id,a.owner).run();return r.meta.changes?out({ok:true}):out({error:'Datei nicht gefunden.'},404);}
 if(!req.headers.get('content-type')?.startsWith('multipart/form-data;'))return out({error:'Dateiupload erforderlich.'},415);
 const body=await boundedBody(req,MAX_FILE_SIZE+64*1024);const form=await new Response(body,{headers:{'Content-Type':req.headers.get('content-type')!}}).formData();const studentId=form.get('studentId'),file=form.get('file');
 if(validId(studentId)&&!canStudent(a,studentId))return out({error:'Kein Zugriff auf diesen Schüler.'},403);
 if(!validId(studentId)||!file||typeof file==='string')return out({error:'Schüler und Datei erforderlich.'},400);
 if(file.size>MAX_FILE_SIZE)return out({error:'Maximal 10 MB pro Datei.'},413);
 const db=database();if(!await db.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='student' AND deleted IS NULL").bind(studentId,a.owner).first())return out({error:'Schüler nicht gefunden.'},404);
 const buffer=new Uint8Array(await file.arrayBuffer());const inspected=inspectFile(file.name,buffer);if(!inspected)return out({error:'Erlaubt: PDF, PNG, JPG, UTF-8-TXT, DOCX, XLSX und PPTX, maximal 10 MB. Dateiformat und Inhalt müssen zusammenpassen.'},400);
 const count=await db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(size),0) AS total FROM files WHERE owner=?').bind(a.owner).first<any>();if(count.count>=1000||count.total+buffer.length>1024*1024*1024)return out({error:'Speichergrenze erreicht (1 GB / 1.000 Dateien einschließlich Papierkorb).'},409);
 await snapshot(a.owner!);const id=crypto.randomUUID(),key=`files/${a.owner}/${id}`;const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(b=>b.toString(16).padStart(2,'0')).join('');
 await bucket().put(key,buffer,{httpMetadata:{contentType:inspected.mime}});uploadedKey=key;
 await db.batch([...teamGuards(a,studentId),db.prepare('INSERT INTO files(id,owner,student_id,name,mime,size,object_key,sha256,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,a.owner,studentId,inspected.name,inspected.mime,buffer.length,key,sha,new Date().toISOString()),db.prepare('DELETE FROM workflow_guards')]);uploadedKey=undefined;return out({ok:true,id},201);
 }catch(e){if(uploadedKey){try{await bucket().delete(uploadedKey);}catch{}}return failure(e);}}
