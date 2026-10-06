'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, supabase } from '../lib/client';
import { channels, emptyState, initials, money, seed, stages, type State, type Contact, type Deal, type Task, type Channel } from '../lib/data';
import Icon from './symbol';

type View = 'Overview'|'Inbox'|'Contacts'|'Pipeline'|'Tasks'|'Channels';
type Workspace = {id: string; name: string};
type Editor = {kind: 'contacts'|'deals'|'tasks'; record?: Contact|Deal|Task}|null;
const nav: [View,string][] = [['Overview','grid'],['Inbox','inbox'],['Contacts','contacts'],['Pipeline','pipeline'],['Tasks','tasks'],['Channels','channels']];
const demoKey = 'intouch.demo.v1';
function ChannelBadge({channel}:{channel:Channel}) { return <span className={`channel-badge ${channel.toLowerCase()}`} title={channel}>{channel==='Facebook'?'f':channel==='Instagram'?'◎':'◔'}</span>; }
function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></div>{children}</dialog>;
}
export default function Crm() {
  const [view,setView] = useState<View>('Overview');
  const [data,setData] = useState<State>(emptyState);
  const [demo,setDemo] = useState(true);
  const [ready,setReady] = useState(false);
  const [email,setEmail] = useState('');
  const [workspaces,setWorkspaces] = useState<Workspace[]>([]);
  const [workspace,setWorkspace] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [search,setSearch] = useState('');
  const [editor,setEditor] = useState<Editor>(null);
  const [auth,setAuth] = useState<'signin'|'signup'|null>(null);
  const [newWorkspace,setNewWorkspace] = useState(false);
  const [channelHelp,setChannelHelp] = useState<Channel|null>(null);
  const [selected,setSelected] = useState('cv0');
  const [filter,setFilter] = useState('All channels');
  const [reply,setReply] = useState('');
  const loadVersion = useRef(0);

  useEffect(()=>{
    let disposed = false;
    const restoreDemo = () => {
      let initial = seed();
      try { const saved = localStorage.getItem(demoKey); if (saved) { const parsed = JSON.parse(saved); if (Object.keys(emptyState).every(k=>Array.isArray(parsed[k]))) initial = parsed; } } catch { /* Use clean synthetic data if browser storage is unavailable. */ }
      setData(initial); setDemo(true); setEmail(''); setWorkspaces([]); setWorkspace(''); setReady(true);
    };
    const loadSession = async (userEmail?: string) => {
      const version = ++loadVersion.current;
      if (!userEmail) {restoreDemo(); return;}
      setDemo(false); setEmail(userEmail); setData(emptyState); setWorkspace(''); setWorkspaces([]); setReady(false);
      try {
        const list: Workspace[] = await api('/workspaces');
        if (disposed || version!==loadVersion.current) return;
        setWorkspaces(list);
        if (list[0]) { const state: State = await api(`/workspaces/${list[0].id}/state`); if (disposed || version!==loadVersion.current) return; setWorkspace(list[0].id); setData(state); }
      } catch(e) {if (!disposed) setNotice((e as Error).message);} finally {if (!disposed && version===loadVersion.current) setReady(true);}
    };
    if (!supabase) { queueMicrotask(restoreDemo); return; }
    const {data:subscription} = supabase.auth.onAuthStateChange((event,session)=>{if (event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='SIGNED_OUT') setTimeout(()=>{if(!disposed) void loadSession(session?.user.email);},0);});
    return ()=>{disposed=true; subscription.subscription.unsubscribe();};
  },[]);

  function saveDemo(next: State) {
    try { localStorage.setItem(demoKey,JSON.stringify(next)); setData(next); } catch {setNotice('Browser storage is full or unavailable. Changes could not be saved.');}
  }
  async function refresh() {setData(await api(`/workspaces/${workspace}/state`));}
  async function mutate(kind:'contacts'|'deals'|'tasks',body:unknown,id?:string,remove=false) {
    if (busy) return; setBusy(true);
    try {
      if (demo) {
        const next = structuredClone(data);
        if (remove && kind==='contacts' && (next.deals.some(d=>d.contact_id===id)||next.tasks.some(t=>t.contact_id===id)||next.conversations.some(c=>c.contact_id===id))) throw new Error('This contact has linked deals, tasks, or conversations. Remove those links first.');
        const records = next[kind] as (Contact|Deal|Task)[];
        if (remove) records.splice(records.findIndex(r=>r.id===id),1);
        else if (id) {const index=records.findIndex(r=>r.id===id); records[index]={...records[index],...(body as object)};}
        else records.unshift({...(body as object),id:crypto.randomUUID()} as Contact|Deal|Task);
        saveDemo(next);
      } else {await api(`/workspaces/${workspace}/${kind}${id?`/${id}`:''}`,remove?'DELETE':id?'PATCH':'POST',remove?undefined:body); await refresh();}
      setEditor(null);
    } catch(e) {setNotice((e as Error).message);} finally {setBusy(false);}
  }
  async function switchWorkspace(id:string) {
    const version=++loadVersion.current; setWorkspace(id); setData(emptyState); setReady(false); setSearch(''); setSelected('');
    try {const state = await api(`/workspaces/${id}/state`); if(version===loadVersion.current) setData(state);} catch(e){setNotice((e as Error).message);} finally {if(version===loadVersion.current)setReady(true);}
  }
  async function submitAuth(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!supabase)return; setBusy(true); setNotice('');
    const form = new FormData(event.currentTarget); const credentials={email:String(form.get('email')),password:String(form.get('password'))};
    try { const result=auth==='signup'?await supabase.auth.signUp(credentials):await supabase.auth.signInWithPassword(credentials); if(result.error)throw result.error; setAuth(null); if(!result.data.session)setNotice('Check your email to confirm your account, then sign in.'); }
    catch(e){setNotice((e as Error).message);} finally{setBusy(false);}
  }
  async function createWorkspace(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {const id = await api('/workspaces','POST',{name:String(new FormData(event.currentTarget).get('name'))}); setWorkspaces(await api('/workspaces')); setNewWorkspace(false); await switchWorkspace(id);} catch(e){setNotice((e as Error).message);} finally{setBusy(false);}
  }
  function submitRecord(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!editor)return;
    const form=new FormData(event.currentTarget); const values=Object.fromEntries(form.entries());
    const body=editor.kind==='contacts'?values:editor.kind==='deals'?{...values,contact_id:values.contact_id||null,value_cents:Math.round(Number(values.value_cents)*100)}:{...values,contact_id:values.contact_id||null,done:editor.record && 'done' in editor.record ? editor.record.done : false};
    void mutate(editor.kind,body,editor.record?.id);
  }
  function navigate(next:View) {setView(next);setSearch('');}
  const contact = (id:string|null) => data.contacts.find(c=>c.id===id);
  const channel = (id:string) => data.channel_connections.find(c=>c.id===id)?.channel || 'WhatsApp';
  const matches = (text:string) => text.toLowerCase().includes(search.toLowerCase());
  const openDeals=data.deals.filter(d=>!['Won','Lost'].includes(d.stage));
  const pending=data.tasks.filter(t=>!t.done);
  const conversation=data.conversations.find(c=>c.id===selected);
  const conversationContact=contact(conversation?.contact_id||null);
  const activeMessages=data.messages.filter(m=>m.conversation_id===selected).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  const visibleConversations=data.conversations.filter(c=>(filter==='All channels'||channel(c.connection_id)===filter)&&matches(contact(c.contact_id)?.name||''));
  const contacts=data.contacts.filter(c=>matches(`${c.name} ${c.company} ${c.email}`));
  const workspaceName=demo?'Studio workspace':workspaces.find(w=>w.id===workspace)?.name||'Your workspace';
  const canEdit=demo||Boolean(workspace);

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="InTouch home"><span className="brand-mark"><Icon name="chat" size={24}/></span>in<span>touch</span><span className="brand-dot">.</span></Link>
      <div className="workspace-card"><span className="workspace-icon">{initials(workspaceName)}</span><div><small>WORKSPACE</small>{demo?<strong>{workspaceName}</strong>:<select aria-label="Current workspace" value={workspace} onChange={e=>void switchWorkspace(e.target.value)} disabled={!ready||busy}><option value="" disabled>Select workspace</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}</div></div>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav>{nav.map(([label,icon])=><button key={label} className={view===label?'nav-item active':'nav-item'} onClick={()=>navigate(label)}><Icon name={icon}/><span>{label}</span>{label==='Inbox'&&data.conversations.length>0&&<span className="count">{data.conversations.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connect-prompt"><div className="tiny-spark">✧</div><strong>Closer to every customer.</strong><p>Bring your conversations together in one place.</p><button onClick={()=>navigate('Channels')}>Explore channels <Icon name="arrow" size={16}/></button></div>
      {demo?<button className="profile" onClick={()=>setAuth('signin')}><span className="avatar small">YO</span><span><strong>Your workspace awaits</strong><small>Sign in or create an account</small></span><Icon name="arrow" size={17}/></button>:<div className="profile"><span className="avatar small">{initials(email)}</span><span className="profile-email"><strong>{email}</strong><button className="text-button" onClick={()=>setNewWorkspace(true)}>New workspace</button></span><button className="icon-button" aria-label="Sign out" onClick={async()=>{const result=await supabase?.auth.signOut(); if(result?.error)setNotice(result.error.message);}}><Icon name="logout" size={17}/></button></div>}</div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{view}</strong></div><div className="top-actions"><span className={`mode-pill ${demo?'':'live'}`}><span/>{demo?'Demo workspace':'Private workspace'}</span><span className="avatar small">{demo?'YO':initials(email)}</span></div></header>
      {demo&&<div className="demo-banner"><span><strong>Take a look around.</strong> Sample data is saved in this browser. Messages are simulated.</span><button onClick={()=>setAuth('signup')}>Create your account <Icon name="arrow" size={15}/></button></div>}
      {notice&&<div className="notice" role="alert">{notice}<button className="icon-button" onClick={()=>setNotice('')} aria-label="Dismiss notification"><Icon name="close" size={16}/></button></div>}
      <main><div className="page-heading"><div><div className="eyebrow">YOUR RELATIONSHIPS, IN FOCUS</div><h1>{view==='Overview'?'A little closer. Every day.':view==='Pipeline'?'Turn conversations into customers.':view==='Channels'?'One inbox. Every conversation.':view}</h1><p>{({Overview:'Good conversations build great businesses. Here’s where yours stand.',Inbox:'Keep the conversation going, wherever it started.',Contacts:'The people at the heart of your business.',Pipeline:'A clear view of every opportunity, from hello to handshake.',Tasks:'Make the next step a thoughtful one.',Channels:'Connect your business accounts and meet your customers where they are.'})[view]}</p></div>{canEdit&&['Overview','Contacts','Pipeline','Tasks'].includes(view)&&<button className="button primary" onClick={()=>setEditor({kind:view==='Pipeline'?'deals':view==='Tasks'?'tasks':'contacts'})}><Icon name="plus" size={17}/>{view==='Pipeline'?'New deal':view==='Tasks'?'New task':'Add contact'}</button>}</div>
      {!ready?<div className="empty">Loading your workspace…</div>:!demo&&!workspace?<div className="onboard panel"><span className="large-icon"><Icon name="contacts" size={32}/></span><h2>A home for your customer relationships</h2><p>Create your first business workspace. Its contacts and conversations are visible only to its members.</p><button className="button primary" onClick={()=>setNewWorkspace(true)}>Create workspace</button></div>:<>
      {view==='Overview'&&<>
        <div className="stats-grid">{[{label:'Total contacts',value:data.contacts.length,icon:'contacts',sub:`${data.contacts.filter(c=>c.status==='Customer').length} customer relationships`},{label:'Open conversations',value:data.conversations.filter(c=>c.status==='Open').length,icon:'chat',sub:demo?'Across 3 sample channels':'Across your connected channels'},{label:'Pipeline value',value:money(openDeals.reduce((n,d)=>n+d.value_cents,0)),icon:'pipeline',sub:`${openDeals.length} opportunities in progress`},{label:'To follow up',value:pending.length,icon:'tasks',sub:'Small steps. Stronger connections.'}].map(stat=><div className="stat-card" key={stat.label}><div className="stat-top">{stat.label}<Icon name={stat.icon} size={19}/></div><div className="stat-value">{stat.value}</div><small>{stat.sub}</small></div>)}</div>
        <div className="overview-grid"><section className="panel"><div className="section-heading"><div><h2>Recent conversations</h2><p>A good time to say hello.</p></div><button className="text-button" onClick={()=>navigate('Inbox')}>View inbox <Icon name="arrow" size={15}/></button></div>{data.conversations.length===0?<div className="empty">Connect a channel to start receiving conversations.</div>:data.conversations.slice(0,5).map(c=>{const person=contact(c.contact_id);const last=data.messages.filter(m=>m.conversation_id===c.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];return <button className="conversation-row" key={c.id} onClick={()=>{setSelected(c.id);navigate('Inbox');}}><span className="avatar">{initials(person?.name||'?')}</span><span className="conversation-summary"><strong>{person?.name}</strong><span>{last?.body||'No messages yet'}</span></span><ChannelBadge channel={channel(c.connection_id)}/><Icon name="arrow" size={16}/></button>;})}</section>
        <section className="panel followup"><div className="section-heading"><div><h2>Your next moves</h2><p>A little follow-through goes a long way.</p></div><span className="soft-count">{pending.length}</span></div>{pending.length?pending.slice(0,4).map(t=><label className="task-row" key={t.id}><input type="checkbox" checked={t.done} disabled={busy} onChange={()=>void mutate('tasks',{done:!t.done},t.id)}/><span><strong>{t.title}</strong><small>{contact(t.contact_id)?.name||'General task'} · {t.due_date}</small></span></label>):<div className="empty">You’re all caught up.</div>}<button className="add-task" onClick={()=>setEditor({kind:'tasks'})}><Icon name="plus" size={16}/>Add a follow-up</button></section></div>
        <section className="channel-strip"><div className="channel-art">{channels.map(c=><ChannelBadge key={c} channel={c}/>)}</div><div><h2>Different channels. One human connection.</h2><p>Your WhatsApp, Messenger, and Instagram conversations, together.</p></div><button className="button secondary" onClick={()=>navigate('Channels')}>Manage channels <Icon name="arrow" size={16}/></button></section>
        <section className="panel pipeline-preview"><div className="section-heading"><div><h2>Your pipeline at a glance</h2><p>Every opportunity starts with a conversation.</p></div><button className="text-button" onClick={()=>navigate('Pipeline')}>View pipeline <Icon name="arrow" size={15}/></button></div><div className="stage-summary">{stages.map((s,i)=>{const deals=data.deals.filter(d=>d.stage===s);return <div key={s}><span className={`stage-dot stage-${i}`}/><span>{s}</span><strong>{money(deals.reduce((n,d)=>n+d.value_cents,0))}</strong><small>{deals.length} deals</small></div>;})}</div></section>
      </>}
      {view==='Contacts'&&<section className="panel"><div className="section-heading"><h2>All contacts <span className="soft-count">{data.contacts.length}</span></h2><Search value={search} onChange={setSearch}/></div><div className="table-scroll"><table><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th><th/></tr></thead><tbody>{contacts.map(c=><tr key={c.id}><td><div className="person-cell"><span className="avatar small">{initials(c.name)}</span><strong>{c.name}</strong></div></td><td>{c.company||'—'}</td><td>{c.email||'—'}</td><td><span className={`status ${c.status.toLowerCase()}`}>{c.status}</span></td><td><button className="text-button" onClick={()=>setEditor({kind:'contacts',record:c})}>Edit</button></td></tr>)}</tbody></table></div>{!contacts.length&&<div className="empty">{search?'No contacts match your search.':'Add your first contact to get started.'}</div>}</section>}
      {view==='Pipeline'&&<div className="kanban">{stages.map((stage,i)=><section className="kanban-column" key={stage}><div className="kanban-heading"><span className={`stage-dot stage-${i}`}/><h2>{stage}</h2><span>{data.deals.filter(d=>d.stage===stage).length}</span></div>{data.deals.filter(d=>d.stage===stage).map(d=><article className="deal-card" key={d.id}><button className="deal-title" onClick={()=>setEditor({kind:'deals',record:d})}>{d.title}</button><p>{contact(d.contact_id)?.name||'No linked contact'}</p><strong>{money(d.value_cents)}</strong><select aria-label={`Stage for ${d.title}`} value={d.stage} disabled={busy} onChange={e=>void mutate('deals',{stage:e.target.value},d.id)}>{stages.map(s=><option key={s}>{s}</option>)}</select></article>)}<button className="add-task" onClick={()=>setEditor({kind:'deals',record:undefined})}><Icon name="plus" size={14}/>New deal</button></section>)}</div>}
      {view==='Tasks'&&<section className="panel"><div className="section-heading"><h2>Follow-ups <span className="soft-count">{pending.length} open</span></h2><Search value={search} onChange={setSearch}/></div>{data.tasks.filter(t=>matches(t.title)).sort((a,b)=>Number(a.done)-Number(b.done)||a.due_date.localeCompare(b.due_date)).map(t=><div className="task-row full" key={t.id}><input type="checkbox" aria-label={`Complete ${t.title}`} checked={t.done} disabled={busy} onChange={()=>void mutate('tasks',{done:!t.done},t.id)}/><span className={t.done?'completed':''}><strong>{t.title}</strong><small>{contact(t.contact_id)?.name||'General task'}</small></span><span className="due-date">{t.due_date}</span><button className="text-button" onClick={()=>setEditor({kind:'tasks',record:t})}>Edit</button></div>)}{!data.tasks.some(t=>matches(t.title))&&<div className="empty">No tasks here. Add a follow-up to keep things moving.</div>}</section>}
      {view==='Channels'&&<><div className="channel-grid">{channels.map(c=><section className="panel channel-card" key={c}><ChannelBadge channel={c}/><span className="status">Not connected</span><h2>{c==='Facebook'?'Facebook Messenger':c}</h2><p>{c==='WhatsApp'?'Build lasting relationships through your WhatsApp Business number.':c==='Facebook'?'Keep every conversation from your Facebook Page in one place.':'Turn interest into relationships through your professional account.'}</p><div className="channel-requirement">{c==='WhatsApp'?'WhatsApp Business account':c==='Facebook'?'Facebook Page':'Instagram professional account'}</div><button className="button secondary" onClick={()=>setChannelHelp(c)}>View connection setup <Icon name="arrow" size={16}/></button></section>)}</div><section className="panel connection-note"><Icon name="contacts" size={24}/><div><h2>Your accounts. Your relationships.</h2><p>Each business will authorize its own accounts. Connection metadata is scoped to your workspace. Live authorization and message delivery are the next integration milestone.</p></div></section></>}
      {view==='Inbox'&&<section className="inbox-layout panel"><div className="inbox-list"><div className="inbox-tools"><Search value={search} onChange={setSearch}/><select aria-label="Filter channel" value={filter} onChange={e=>setFilter(e.target.value)}><option>All channels</option>{channels.map(c=><option key={c}>{c}</option>)}</select></div>{visibleConversations.map(c=><button key={c.id} className={`inbox-item ${selected===c.id?'selected':''}`} onClick={()=>{setSelected(c.id);setReply('');}}><span className="avatar small">{initials(contact(c.contact_id)?.name||'?')}</span><span><strong>{contact(c.contact_id)?.name}</strong><small>{channel(c.connection_id)}</small></span><ChannelBadge channel={channel(c.connection_id)}/></button>)}{!visibleConversations.length&&<div className="empty">No conversations yet.</div>}</div><div className="thread">{conversation?<><div className="thread-heading"><span className="avatar">{initials(conversationContact?.name||'?')}</span><div><strong>{conversationContact?.name}</strong><small>{channel(conversation.connection_id)} · {demo?'Sample conversation':conversation.status}</small></div></div><div className="messages">{activeMessages.map(m=><div key={m.id} className={`message ${m.direction}`}><p>{m.body}</p><small>{new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}{m.direction==='outbound'&&demo?' · Demo only':''}</small></div>)}</div><form className="composer" onSubmit={e=>{e.preventDefault();if(!demo||!reply.trim())return;saveDemo({...data,messages:[...data.messages,{id:crypto.randomUUID(),conversation_id:selected,body:reply.trim(),direction:'outbound',created_at:new Date().toISOString()}]});setReply('');}}><label htmlFor="reply">{demo?'Try a reply — saved locally, never sent':'Live sending is not configured'}</label><div><input id="reply" maxLength={4000} value={reply} disabled={!demo} onChange={e=>setReply(e.target.value)} placeholder="Write a thoughtful reply…"/><button className="button primary" disabled={!demo||!reply.trim()} type="submit">Save demo reply <Icon name="arrow" size={15}/></button></div></form></>:<div className="empty thread-empty"><Icon name="chat" size={40}/><h2>A conversation starts with hello.</h2><p>{data.conversations.length?'Select a conversation to read it.':'Connect a channel to receive your customer messages.'}</p><button className="button secondary" onClick={()=>navigate('Channels')}>Explore channels</button></div>}</div></section>}
      </>}
      <footer>Made for real relationships.<span>InTouch · {demo?'Local preview':'Your business workspace'}</span></footer>
      </main>
    </div>
    {editor&&<Modal title={`${editor.record?'Edit':'New'} ${editor.kind==='contacts'?'contact':editor.kind==='deals'?'deal':'task'}`} onClose={()=>{if(!busy)setEditor(null);}}><form onSubmit={submitRecord} className="form-grid">
      {editor.kind==='contacts'?<><Field label="Full name" name="name" defaultValue={(editor.record as Contact)?.name} required/><Field label="Email" name="email" type="email" defaultValue={(editor.record as Contact)?.email}/><Field label="Phone" name="phone" defaultValue={(editor.record as Contact)?.phone}/><Field label="Company" name="company" defaultValue={(editor.record as Contact)?.company}/><label>Status<select name="status" defaultValue={(editor.record as Contact)?.status||'Lead'}>{['Lead','Customer','Inactive'].map(s=><option key={s}>{s}</option>)}</select></label></>:<><Field label="Title" name="title" defaultValue={(editor.record as Deal|Task)?.title} required/><label>Contact<select name="contact_id" defaultValue={(editor.record as Deal|Task)?.contact_id||''}><option value="">No linked contact</option>{data.contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{editor.kind==='deals'?<><Field label="Value (USD)" name="value_cents" type="number" min="0" max="1000000000" step="0.01" defaultValue={((editor.record as Deal)?.value_cents||0)/100} required/><label>Stage<select name="stage" defaultValue={(editor.record as Deal)?.stage||'New'}>{stages.map(s=><option key={s}>{s}</option>)}</select></label></>:<Field label="Due date" name="due_date" type="date" defaultValue={(editor.record as Task)?.due_date||new Date().toISOString().slice(0,10)} required/>}</>}
      <div className="form-actions">{editor.record&&<button type="button" disabled={busy} className="text-button danger" onClick={()=>{if(window.confirm('Delete this record? This cannot be undone.'))void mutate(editor.kind,{},editor.record?.id,true);}}>Delete</button>}<button className="button primary" disabled={busy} type="submit">{busy?'Saving…':'Save changes'}</button></div></form></Modal>}
    {auth&&<Modal title={auth==='signin'?'Welcome back':'Get closer to your customers'} onClose={()=>setAuth(null)}>{supabase?<form onSubmit={submitAuth} className="form-grid"><p>Sign in to your private InTouch workspace.</p><Field label="Email" name="email" type="email" required/><Field label="Password" name="password" type="password" minLength={8} required/><button className="button primary" disabled={busy}>{busy?'Please wait…':auth==='signup'?'Create account':'Sign in'}</button><button type="button" className="text-button" onClick={()=>setAuth(auth==='signin'?'signup':'signin')}>{auth==='signin'?'New here? Create an account':'Already have an account? Sign in'}</button></form>:<div className="setup-message"><p>Account registration is not available in this local preview yet. Connect the InTouch Supabase project to enable private accounts.</p><p>You can explore contacts, deals, tasks, and sample conversations now.</p><button className="button primary" onClick={()=>setAuth(null)}>Continue exploring</button></div>}</Modal>}
    {newWorkspace&&<Modal title="Create a business workspace" onClose={()=>setNewWorkspace(false)}><form onSubmit={createWorkspace} className="form-grid"><Field label="Business name" name="name" maxLength={100} required/><p>Your workspace starts empty. Demo contacts are never copied into your real account.</p><button className="button primary" disabled={busy}>Create workspace</button></form></Modal>}
    {channelHelp&&<Modal title={`Connect ${channelHelp}`} onClose={()=>setChannelHelp(null)}><div className="setup-message"><ChannelBadge channel={channelHelp}/><h3>Live connections are not available yet</h3><p>This preview cannot authorize accounts or send customer messages. The next milestone is Meta account authorization, verified incoming messages, and delivery tracking.</p><p>When available, each business owner will connect their own {channelHelp==='WhatsApp'?'WhatsApp Business account':channelHelp==='Facebook'?'Facebook Page':'Instagram professional account'} through Meta.</p><button className="button primary" onClick={()=>setChannelHelp(null)}>Got it</button></div></Modal>}
  </div>;
}
function Search({value,onChange}:{value:string;onChange:(v:string)=>void}) {return <label className="search"><Icon name="search" size={17}/><input aria-label="Search" placeholder="Search…" value={value} onChange={e=>onChange(e.target.value)}/></label>;}
function Field({label,...props}:{label:string}&React.InputHTMLAttributes<HTMLInputElement>) {return <label>{label}<input maxLength={300} {...props}/></label>;}
