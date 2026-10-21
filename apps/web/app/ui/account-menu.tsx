import { useEffect, useId, useRef, useState } from 'react';
import { initials } from '../lib/data';
import Icon from './symbol';
import { ThemeSelect } from './theme';

export default function AccountMenu({email,workspaceName,role,onNewWorkspace,onChangePassword,onSignOut}:{
  email:string; workspaceName:string; role?:string;
  onNewWorkspace:()=>void; onChangePassword:()=>void; onSignOut:()=>Promise<void>;
}) {
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const panelId=useId();

  useEffect(()=>{
    if(!open)return;
    function outside(event:PointerEvent) {
      if(!ref.current?.contains(event.target as Node))setOpen(false);
    }
    function escape(event:KeyboardEvent) {
      if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}
    }
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return ()=>{
      document.removeEventListener('pointerdown',outside);
      document.removeEventListener('keydown',escape);
    };
  },[open]);

  function select(action:()=>void) {setOpen(false);trigger.current?.focus();action();}

  return <div className="account-menu" ref={ref} onBlur={event=>{
    if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);
  }}>
    <button ref={trigger} type="button" className="avatar small account-trigger" aria-label="Your account"
      aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(!open)}>{initials(email)}</button>
    {open&&<section className="account-panel" id={panelId} aria-label="Account menu">
      <div className="account-summary"><strong>{email}</strong><small>{workspaceName}{role?` · ${role}`:''}</small></div>
      <ThemeSelect/>
      <button type="button" onClick={()=>select(onChangePassword)}>Change password</button>
      <button type="button" onClick={()=>select(onNewWorkspace)}><Icon name="plus" size={16}/>New workspace</button>
      <button type="button" onClick={()=>select(()=>void onSignOut())}><Icon name="logout" size={16}/>Sign out</button>
    </section>}
  </div>;
}
