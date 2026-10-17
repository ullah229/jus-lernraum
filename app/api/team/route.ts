import {z} from 'zod';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {access,out,database,jsonBody,failure,validId,snapshot} from '@/lib/server-data';
import {configuredOwner,tokenHash,denyAdmin} from '@/lib/team';
export const dynamic='force-dynamic';
export async function GET(){const a=await access();if(a.error)return a.error;try{const members=await database().prepare('SELECT id,name,email,rate,active,version,user_id IS NOT NULL AS connected FROM team_members WHERE owner=?'+(a.role==='teacher'?' AND id=?':'')+' ORDER BY name').bind(...(a.role==='teacher'?[a.owner,a.memberId]:[a.owner])).all();const assignments=a.role==='admin'?(await database().prepare('SELECT student_id AS studentId,member_id AS memberId FROM student_assignments WHERE owner=?').bind(a.owner).all()).results:a.assigned.map(studentId=>({studentId,memberId:a.memberId}));return out({role:a.role,memberId:a.memberId,assigned:a.assigned,members:members.results,assignments});}catch(e){return failure(e);}}
export async function POST(req:Request){try{
 const user=await getChatGPTUser();if(!user)return out({error:'Bitte anmelden.'},401);if(req.headers.get('origin')!==new URL(req.url).origin)return out({error:'Ungültiger Ursprung.'},403);const b=await jsonBody(req),db=database(),now=new Date().toISOString();
 if(b.action==='accept'){
 const token=z.string().min(40).max(200).parse(b.token),hash=await tokenHash(token),owner=configuredOwner();if(!owner)return out({error:'Team noch nicht konfiguriert.'},503);
 const member=await db.prepare('SELECT * FROM team_members WHERE owner=? AND invite_hash=? AND invite_expires>? AND active=1').bind(owner,hash,now).first<any>();if(!member||member.email!==user.email.trim().toLowerCase()||member.user_id&&member.user_id!==user.userId)return out({error:'Der Link ist abgelaufen, ungültig oder gehört zu einer anderen E-Mail-Adresse. Bitte mit dem eingeladenen Konto anmelden.'},403);
 const r=await db.prepare('UPDATE team_members SET user_id=?,invite_hash=NULL,invite_expires=NULL,version=version+1 WHERE id=? AND owner=? AND invite_hash=? AND active=1 AND invite_expires>?').bind(user.userId,member.id,owner,hash,now).run();return r.meta.changes?out({ok:true}):out({error:'Link bereits verwendet.'},409);
 }
 const a=await access(req);if(a.error)return a.error;const denied=denyAdmin(a);if(denied)return denied;
 if(!validId(b.id))return out({error:'Ungültige Kennung.'},400);
 const old=await db.prepare('SELECT * FROM team_members WHERE id=? AND owner=?').bind(b.id,a.owner).first<any>();
 if(b.action==='save'){
 const m=z.object({name:z.string().trim().min(1).max(160),email:z.string().trim().email().max(200).transform(s=>s.toLowerCase()),rate:z.number().int().min(0).max(10000000),active:z.boolean()}).parse(b.data);
 if(old&&old.version!==b.version)return out({error:'Lehrkraft wurde geändert. Bitte aktualisieren.'},409);
 if(old?.user_id&&old.email!==m.email)return out({error:'Eine verbundene E-Mail kann nicht geändert werden. Für einen Kontowechsel den Zugang deaktivieren und einen neuen anlegen.'},400);
 await snapshot(a.owner);
 if(old){const r=await db.prepare('UPDATE team_members SET name=?,email=?,rate=?,active=?,version=version+1,invite_hash=NULL,invite_expires=NULL WHERE id=? AND owner=? AND version=?').bind(m.name,m.email,m.rate,m.active?1:0,b.id,a.owner,b.version).run();if(!r.meta.changes)return out({error:'Lehrkraft wurde geändert.'},409);}
 else{if(b.version!==0)return out({error:'Lehrkraft fehlt.'},409);await db.prepare('INSERT INTO team_members(id,owner,name,email,rate,active,created) VALUES(?,?,?,?,?,?,?)').bind(b.id,a.owner,m.name,m.email,m.rate,m.active?1:0,now).run();}return out({ok:true});
 }
 if(!old)return out({error:'Lehrkraft nicht gefunden.'},404);
 if(b.action==='invite'){
 if(!old.active)return out({error:'Lehrkraft zuerst aktivieren.'},400);const bytes=crypto.getRandomValues(new Uint8Array(32));const token=Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');await db.prepare('UPDATE team_members SET invite_hash=?,invite_expires=?,version=version+1 WHERE id=? AND owner=? AND active=1').bind(await tokenHash(token),new Date(Date.now()+7*86400000).toISOString(),b.id,a.owner).run();return out({ok:true,url:new URL('/join?token='+token,req.url).href});
 }
 if(b.action==='assign'){
 const ids=z.array(z.string().uuid()).max(1000).parse(b.studentIds);const all=(await db.prepare("SELECT id FROM records WHERE owner=? AND kind='student' AND deleted IS NULL").bind(a.owner).all<any>()).results;if(ids.some(id=>!all.some(s=>s.id===id)))return out({error:'Schülerzuordnung ungültig.'},400);if(old.version!==b.version)return out({error:'Lehrkraft wurde geändert. Bitte aktualisieren.'},409);await snapshot(a.owner);await db.batch([db.prepare('INSERT INTO workflow_guards(id,valid) VALUES(?,EXISTS(SELECT 1 FROM team_members WHERE id=? AND owner=? AND version=?))').bind(crypto.randomUUID(),b.id,a.owner,b.version),db.prepare('DELETE FROM student_assignments WHERE owner=? AND member_id=?').bind(a.owner,b.id),...Array.from(new Set(ids)).map(id=>db.prepare('INSERT INTO student_assignments(id,owner,student_id,member_id) VALUES(?,?,?,?)').bind(crypto.randomUUID(),a.owner,id,b.id)),db.prepare('UPDATE team_members SET version=version+1 WHERE id=? AND owner=?').bind(b.id,a.owner),db.prepare('DELETE FROM workflow_guards')]);return out({ok:true});
 }
 return out({error:'Unbekannte Aktion.'},400);
 }catch(e){if(e instanceof z.ZodError)return out({error:'Bitte Namen, E-Mail und Honorar prüfen.'},400);return failure(e);}}
