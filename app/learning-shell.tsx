'use client';
import ThemeToggle from './theme-toggle';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {BookOpen,CalendarDays,ChartNoAxesCombined,ChevronRight,FolderOpen,GraduationCap,HardDrive,LayoutDashboard,LogOut,Menu,RefreshCw,Settings,ShieldCheck,Users,Wallet,X} from 'lucide-react';

const groups=[
 {label:'Lernen & Unterricht',items:[['Übersicht',LayoutDashboard],['Schüler',Users],['Gruppen',Users],['Termine',CalendarDays],['Lernentwicklung',ChartNoAxesCombined],['Hausaufgaben',BookOpen],['Materialien',FolderOpen]]},
 {label:'Organisation',items:[['Lehrkräfte',GraduationCap],['Honorare',Wallet],['Finanzen',Wallet],['Abrechnungen',Wallet],['Erinnerungen',CalendarDays]]},
 {label:'Verwaltung',items:[['Datensicherung',HardDrive],['Einstellungen',Settings]]},
] as const;
const teacherGroups=[{label:'Mein Unterricht',items:[['Übersicht',LayoutDashboard],['Meine Schüler',Users],['Gruppen',Users],['Meine Termine',CalendarDays],['Lernentwicklung',ChartNoAxesCombined],['Hausaufgaben',BookOpen],['Materialien',FolderOpen]]},{label:'Organisation',items:[['Meine Honorare',Wallet]]}] as const;
export const pageLabel=(page:string)=>page==='Übersicht'?'Dashboard':page;
export default function LearningShell({page,onNavigate,onRefresh,loading=false,teacher=false,name,children}:{page:string;onNavigate:(page:string)=>void;onRefresh:()=>void;loading?:boolean;teacher?:boolean;name?:string;children:ReactNode}){
 const [drawer,setDrawer]=useState(false);const toggle=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!drawer)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setDrawer(false);toggle.current?.focus();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[drawer]);
 function go(target:string){onNavigate(target);setDrawer(false);requestAnimationFrame(()=>document.getElementById('learning-content')?.focus());}
 const studentPage=teacher?'Meine Schüler':'Schüler',calendarPage=teacher?'Meine Termine':'Termine';
 const primary=[['Dashboard','Übersicht'],[teacher?'Meine Schüler':'Lernbereiche',studentPage],['Kalender',calendarPage],['Materialien','Materialien']];
 const title=name||'JUS Verwaltung';
 return <div className={'learning-app '+(drawer?'drawer-open':'')}>
  <a href="#learning-content" className="skip-link">Zum Inhalt springen</a>
  <header className="learning-header">
   <button ref={toggle} className="icon drawer-toggle" aria-label={drawer?'Navigation schließen':'Navigation öffnen'} aria-expanded={drawer} aria-controls="learning-navigation" onClick={()=>setDrawer(!drawer)}>{drawer?<X size={22}/>:<Menu size={22}/>}</button>
   <a className="learning-brand" href="/" aria-label="JUS Lernraum – Startseite"><span className="brand-emblem"><GraduationCap size={26}/></span><span>JUS <b>Lernraum</b></span></a>
   <nav className="primary-nav" aria-label="Hauptnavigation">{primary.map(([label,target])=><button key={target} className={page===target?'active':''} aria-current={page===target?'page':undefined} onClick={()=>go(target)}>{label}</button>)}</nav>
   <div className="header-account"><ThemeToggle/><span className="role-chip"><ShieldCheck size={14}/>{teacher?'Lehrkraft':'Administration'}</span><button className="icon" onClick={onRefresh} disabled={loading} aria-label="Daten aktualisieren" title="Daten aktualisieren"><RefreshCw size={18} className={loading?'spin':''}/></button><span className="account-avatar" title={title}>{title.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span></div>
  </header>
  <div className="learning-body">
   {drawer&&<button tabIndex={-1} className="drawer-backdrop" aria-label="Navigation schließen" onClick={()=>setDrawer(false)}/>}
   <aside id="learning-navigation" className="learning-sidebar" aria-label="Bereiche">
    <div className="workspace-label"><span className="workspace-icon"><BookOpen size={19}/></span><div><strong>JUS Nachhilfen</strong><small>Gemeinsam weiterkommen</small></div></div>
    <nav aria-label="Bereichsnavigation">{(teacher?teacherGroups:groups).map(group=><div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(([target,Icon])=><button key={target} className={'learning-nav-item '+(page===target?'active':'')} aria-current={page===target?'page':undefined} onClick={()=>go(target)}><Icon size={18}/><span>{pageLabel(target)}</span>{page===target&&<ChevronRight className="nav-chevron" size={15}/>}</button>)}</div>)}</nav>
    <div className="sidebar-account"><span className="account-avatar">{title.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span><div><strong>{title}</strong><small>{teacher?'Persönlicher Zugang':'Dein Arbeitsbereich'}</small></div><a className="icon" href="/signout-with-chatgpt?return_to=/" aria-label="Abmelden" title="Abmelden"><LogOut size={17}/></a></div>
   </aside>
   <div className="learning-main"><div className="breadcrumbs"><button onClick={()=>go('Übersicht')}>JUS Lernraum</button><ChevronRight size={13}/><span>{pageLabel(page)}</span><span className="workspace-status"><span/>Geschützter Teambereich</span></div><main id="learning-content" className="content" tabIndex={-1}>{children}</main><footer className="learning-footer"><span>JUS Lernraum</span><span>Mehr als nur Nachhilfe.</span></footer></div>
  </div>
 </div>;
}
