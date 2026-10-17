'use client';
import {useEffect,useState} from 'react';
import {Moon,Sun} from 'lucide-react';
const key='jus-theme';
export default function ThemeToggle(){
 const [dark,setDark]=useState(false);
 useEffect(()=>{
  setDark(document.documentElement.dataset.theme==='dark');
  const sync=(event:StorageEvent)=>{if(event.key!==key&&event.key!==null)return;const next=event.newValue==='dark';document.documentElement.dataset.theme=next?'dark':'light';setDark(next);};
  window.addEventListener('storage',sync);
  return()=>window.removeEventListener('storage',sync);
 },[]);
 function toggle(){const next=!dark;document.documentElement.dataset.theme=next?'dark':'light';setDark(next);try{localStorage.setItem(key,next?'dark':'light');}catch{/* The switch still works when browser storage is unavailable. */}}
 return <button type="button" className="icon theme-toggle" aria-label="Dunkelmodus" aria-pressed={dark} title={dark?'Zum hellen Design wechseln':'Zum dunklen Design wechseln'} onClick={toggle}>{dark?<Sun size={19}/>:<Moon size={19}/>}</button>;
}
