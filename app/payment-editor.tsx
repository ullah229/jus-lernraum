'use client';
import {useState,type FormEvent} from 'react';
import type {Entry} from '@/lib/domain';
import {accounting,euro,paymentMethods} from '@/lib/accounting';
import {berlinDay} from '@/lib/workflows';
import {api,Dialog,Fields} from './operations';
export default function PaymentEditor({rows,entry,id,onClose,onSaved}:{rows:Entry[];entry?:Entry;id:string;onClose:()=>void;onSaved:()=>Promise<void>}){
 const ledger=accounting(rows),students=rows.filter(r=>r.kind==='student');
 const [studentId,setStudentId]=useState(entry?.data.studentId||students[0]?.id||'');
 const [amount,setAmount]=useState(entry?.data.amount?String(entry.data.amount/100):'');
 const initial=entry?.version?ledger.allocationsByPayment.get(entry.id)||[]:entry?.data.invoiceId?[{invoiceId:entry.data.invoiceId,amount:entry.data.amount}]:[];
 const [allocations,setAllocations]=useState<Record<string,string>>(()=>Object.fromEntries(initial.map(a=>[a.invoiceId,String(a.amount/100)])));
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const others=accounting(rows.filter(r=>r.id!==entry?.id));
 const invoices=rows.filter(r=>r.kind==='invoice'&&r.data.studentId===studentId&&r.data.status==='issued').sort((a,b)=>a.data.due.localeCompare(b.data.due));
 const cents=(v:string)=>Math.round(Number(v||0)*100);
 const used=Object.values(allocations).reduce((n,v)=>n+cents(v),0),remaining=cents(amount)-used;
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  const form=Object.fromEntries(new FormData(e.currentTarget));
  await api('/api/records',{action:'save',kind:'payment',id,version:entry?.version||0,data:{studentId,date:form.date,amount:cents(amount),method:form.method,notes:form.notes,allocations:Object.entries(allocations).filter(([,value])=>cents(value)>0).map(([invoiceId,value])=>({invoiceId,amount:cents(value)}))}});
  await onSaved();onClose();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function remove(){if(!entry?.version||!confirm('Zahlung entfernen? Ihre Zuordnungen werden aufgehoben und die Rechnungen wieder offen.'))return;setBusy(true);try{await api('/api/records',{action:'delete',kind:'payment',id,version:entry.version});await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Dialog title={entry?.version?'Zahlung und Zuordnungen bearbeiten':'Zahlung erfassen'} close={()=>{if(!busy)onClose();}}><form onSubmit={save}><Fields><label className="full">Schüler<select required value={studentId} onChange={e=>{setStudentId(e.target.value);setAllocations({});}}>{students.map(s=><option value={s.id} key={s.id}>{s.data.name}</option>)}</select></label><label>Zahlungsdatum<input required type="date" name="date" defaultValue={entry?.data.date||berlinDay()}/></label><label>Eingegangener Betrag (€)<input required type="number" min="0.01" max="100000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Zahlungsart<select name="method" defaultValue={entry?.data.method|| (entry?.version?'Nicht angegeben':'Überweisung')}>{paymentMethods.map(m=><option key={m}>{m}</option>)}</select></label><label className="full">Notiz / Zahlungsreferenz<textarea name="notes" maxLength={4000} defaultValue={entry?.data.notes}/></label></Fields><div className="payment-allocation"><h3>Rechnungen zuordnen</h3><p>Trage Teilbeträge ein. Nicht zugeordnetes Geld bleibt als Guthaben beim Schüler.</p>{invoices.map(i=>{const open=Math.max(0,i.data.gross-(others.paidByInvoice.get(i.id)||0));if(!open&&!allocations[i.id])return null;return <div className="allocation-row" key={i.id}><div><a href={'/api/invoice?id='+i.id} target="_blank" rel="noreferrer">{i.data.number} ↗</a><small>Verfügbar für diese Zahlung: {euro(open)}</small></div><label><span className="sr-only">Zuordnung für {i.data.number} in Euro</span><input type="number" min="0" max={open/100} step="0.01" value={allocations[i.id]||''} placeholder="0,00 €" onChange={e=>setAllocations({...allocations,[i.id]:e.target.value})}/></label><button type="button" className="secondary" onClick={()=>setAllocations({...allocations,[i.id]:String(Math.max(0,Math.min(open,remaining+cents(allocations[i.id]||'')))/100)})}>Rest zuordnen</button></div>;})}{!invoices.length&&<p>Noch keine ausgestellten Rechnungen. Die Zahlung wird als Guthaben gespeichert.</p>}<div className={'allocation-balance '+(remaining<0?'allocation-error':'')}><span>Zugeordnet: <strong>{euro(used)}</strong></span><span>Verbleibendes Guthaben: <strong>{euro(remaining)}</strong></span></div></div>{error&&<p className="alert" role="alert">{error}</p>}<div className="dialog-actions">{entry?.version? <button className="danger" type="button" disabled={busy} onClick={()=>void remove()}>Zahlung entfernen</button>:null}<button className="primary" disabled={busy||remaining<0||!studentId}>{busy?'Speichert …':'Zahlung speichern'}</button></div></form></Dialog>;
}
