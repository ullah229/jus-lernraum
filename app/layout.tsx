import type { Metadata } from 'next';
import './globals.css';
import './learning.css';
import './theme.css';
export const metadata:Metadata={title:'JUS Lernraum · Nachhilfe mit Überblick',description:'Schüler, Lernentwicklung, Unterricht und Finanzen an einem Ort.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="de" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('jus-theme')==='dark'?'dark':'light'}catch(e){}"}}/></head><body>{children}</body></html>;}
