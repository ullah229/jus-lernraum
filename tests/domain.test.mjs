import test from 'node:test';
import assert from 'node:assert/strict';
import {schemas,billable,calendarDates,ics} from '../lib/domain.ts';
test('Leistungswert verwendet gehaltene Stunden, Cent und anteilige Dauer',()=>{
 assert.equal(billable({rate:2500,minutes:90,status:'gehalten'}),3750);
 assert.equal(billable({rate:2500,minutes:45,status:'gehalten'}),1875);
 assert.equal(billable({rate:2500,minutes:60,status:'abgesagt'}),0);
 assert.equal(billable({rate:2500,minutes:60,status:'geplant'}),0);
});
test('Ungültige Messungen und Kalendertage werden abgewiesen',()=>{
 const p={studentId:'f812465a-5a80-45d3-86f5-e9911f6f472f',date:'2026-10-11',topic:'Brüche',level:'mit Hilfe',correct:4,total:5,notes:'',next:''};
 assert.equal(schemas.progress.safeParse(p).success,true);
 assert.equal(schemas.progress.safeParse({...p,correct:6}).success,false);
 assert.equal(schemas.progress.safeParse({...p,date:'2026-02-30'}).success,false);
 assert.equal(schemas.payment.safeParse({studentId:p.studentId,date:p.date,amount:-1,notes:''}).success,false);
 assert.equal(schemas.payment.safeParse({studentId:p.studentId,date:p.date,amount:1.2,notes:''}).success,false);
});
test('Kalenderexport erhält UTC-Zeiten, stabile IDs, Versionen und keine Schülerdaten',()=>{
 assert.deepEqual(calendarDates('2026-10-25T00:30:00Z',90),['20261025T003000Z','20261025T020000Z']);
 const item={id:'test-event',kind:'lesson',version:2,updated:'2026-10-11T12:00:00Z',data:{start:'2026-10-25T00:30:00Z',minutes:90,status:'geplant',studentId:'private-id',notes:'private note'}};
 const output=ics([item,{...item,id:'cancelled',data:{...item.data,status:'abgesagt'}}]);
 assert.match(output,/UID:test-event@jus-lernraum/);assert.match(output,/SEQUENCE:2/);
 assert.equal(output.includes('private'),false);assert.equal(output.includes('cancelled'),false);
 assert.match(output,/DTEND:20261025T020000Z/);
});

test('Dateiprüfung begrenzt Größe und lehnt aktive oder falsch benannte Inhalte ab',async()=>{
 const {inspectFile,MAX_FILE_SIZE}=await import('../lib/file-policy.ts');
 assert.equal(inspectFile('attack.pdf',new TextEncoder().encode('<script>evil</script>')),null);
 assert.equal(inspectFile('attack.html',new TextEncoder().encode('hello')),null);
 assert.equal(inspectFile('leer.txt',new Uint8Array()),null);
 assert.equal(inspectFile('large.txt',new Uint8Array(MAX_FILE_SIZE+1)),null);
 assert.equal(inspectFile('../notes.txt',new TextEncoder().encode('Hallo')).name,'notes.txt');
});
test('Berlin-Zeiten bleiben unabhängig von der Gerätezeitzone korrekt',async()=>{
 const {berlinToUtc,berlinInput}=await import('../lib/time.ts');
 assert.equal(berlinToUtc('2026-10-12T15:00'),'2026-10-12T13:00:00.000Z');
 assert.equal(berlinToUtc('2026-12-12T15:00'),'2026-12-12T14:00:00.000Z');
 assert.equal(berlinInput('2026-10-12T13:00:00.000Z'),'2026-10-12T15:00');
 assert.throws(()=>berlinToUtc('2026-03-29T02:30'));
 assert.throws(()=>berlinToUtc('2026-10-25T02:30'));
});
test('Serien überspringen Ausnahmen und verweigern mehrdeutige Zeitumstellung',async()=>{
 const {seriesDates,amounts}=await import('../lib/workflows.ts');
 assert.deepEqual(seriesDates('2027-03-21T14:00:00.000Z',3,1,['2027-03-28']),['2027-03-21T14:00:00.000Z','2027-04-04T13:00:00.000Z']);
 assert.throws(()=>seriesDates('2027-03-21T01:30:00.000Z',2,1,[]));
 assert.throws(()=>seriesDates('2027-03-21T14:00:00.000Z',53,1,[]));
 assert.deepEqual(amounts([{amount:11900}],'19'),{gross:11900,net:10000,tax:1900});
});
test('Portables TAR-Archiv prüft Header und verweigert beschädigte Dateien',async()=>{
 const {tarEntries,tarHeader,tarPadding}=await import('../lib/tar.ts');const content=new TextEncoder().encode('Test');const h=tarHeader('manifest.json',content.length);
 const file=new File([h,content,tarPadding(content.length),new Uint8Array(1024)],'test.tar');const result=[];for await(const entry of tarEntries(file))result.push([entry.name,await entry.blob.text()]);assert.deepEqual(result,[['manifest.json','Test']]);
 h[0]=100;await assert.rejects(async()=>{for await(const entry of tarEntries(new File([h,content,new Uint8Array(1024)],'corrupt.tar'))){}},/Ungültiges/);
});
