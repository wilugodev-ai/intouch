import type { Metadata } from 'next';
import './globals.css';
import './theme.css';
import { ThemeController } from './ui/theme';
export const metadata: Metadata = {
  title:'Touchlumo | Smarter Connections. Stronger Relationships.',
  applicationName:'Touchlumo',
  description:'Smarter Connections. Stronger Relationships. A private CRM for your contacts, opportunities, and follow-ups.',
  openGraph:{title:'Touchlumo',siteName:'Touchlumo',description:'Smarter Connections. Stronger Relationships.',type:'website',locale:'en_US'},
  twitter:{card:'summary',title:'Touchlumo',description:'Smarter Connections. Stronger Relationships.'},
};
const themeScript=`(()=>{let p='system';try{const v=localStorage.getItem('intouch-theme');if(v==='light'||v==='dark')p=v;}catch{}const r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;})();`;
export default function Layout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body><ThemeController/>{children}</body></html>; }
