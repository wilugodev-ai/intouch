'use client';
import { useEffect, useId, useSyncExternalStore } from 'react';

type Theme='light'|'dark'|'system';
const storageKey='intouch-theme';
const changeEvent='intouch-theme-change';
let temporaryPreference:Theme|null=null;
const valid=(value:string|null|undefined):Theme=>value==='light'||value==='dark'?value:'system';

function preference():Theme {
  if(temporaryPreference!==null)return temporaryPreference;
  try {return valid(localStorage.getItem(storageKey));}
  catch {return valid(document.documentElement.dataset.themePreference);}
}
function subscribe(change:()=>void) {
  const storage=(event:StorageEvent)=>{if(event.key===storageKey||event.key===null)change();};
  window.addEventListener(changeEvent,change);
  window.addEventListener('storage',storage);
  return ()=>{window.removeEventListener(changeEvent,change);window.removeEventListener('storage',storage);};
}
function usePreference() {return useSyncExternalStore(subscribe,preference,()=>'system' as Theme);}
function apply(value:Theme) {
  const root=document.documentElement;
  root.dataset.themePreference=value;
  root.dataset.theme=value==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):value;
}
function choose(value:Theme) {
  try {localStorage.setItem(storageKey,value);temporaryPreference=null;} catch {temporaryPreference=value;}
  apply(value);
  window.dispatchEvent(new Event(changeEvent));
}

export function ThemeController() {
  const value=usePreference();
  useEffect(()=>{
    apply(value);
    const media=matchMedia('(prefers-color-scheme: dark)');
    const update=()=>apply(value);
    media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[value]);
  return null;
}

export function ThemeSelect() {
  const id=useId();
  const value=usePreference();
  return <div className="theme-select"><label htmlFor={id}>Appearance</label>
    <select id={id} value={value} onChange={event=>choose(valid(event.target.value))}>
      <option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option>
    </select>
  </div>;
}
