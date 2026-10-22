'use client';
import {WhatsAppConnections,WhatsAppInbox} from './whatsapp';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import CustomerPage from './customer-page';
import { api, supabase, consumePasswordRecovery } from '../lib/client';
import {ContactsList, TasksList, PipelineBoard} from './core-records';
import ContactPicker from './contact-picker';
import { channels, emptyState, initials, money, type State, type Contact, type Deal, type Task, type Channel } from '../lib/data';
import Icon from './symbol';
import {Team,ContactDetails,CsvImport,StageSettings} from './workflows';
import {BusinessModule,Reports} from './business';
import RegistrationManager from './registration-manager';
import {BirthdayFields,PreferredChannel} from './customer-fields';
import AccountMenu from './account-menu';
import PasswordField from './password-field';
import { ThemeSelect } from './theme';
import { isSessionIdle, recordActivity, watchIdleSession } from '../lib/idle-session';

type View = 'Overview'|'Inbox'|'Contacts'|'Pipeline'|'Tasks'|'Channels'|'Team'|'Reports'|'Automations'|'Quotes'|'Appointments'|'Tickets'|'Registration';
type Workspace = {id: string; name: string};
type Editor = {kind: 'contacts'|'deals'|'tasks'; record?: Contact|Deal|Task;contactId?:string}|null;
const nav: [View,string][] = [['Overview','grid'],['Inbox','inbox'],['Contacts','contacts'],['Pipeline','pipeline'],['Tasks','tasks'],['Channels','channels'],['Team','contacts'],['Reports','grid'],['Automations','tasks'],['Quotes','pipeline'],['Appointments','tasks'],['Tickets','inbox'],['Registration','contacts']];
function ChannelBadge({channel}:{channel:Channel}) { return <span className={`channel-badge ${channel.toLowerCase()}`} title={channel}>{channel==='Facebook'?'f':channel==='Instagram'?'◎':'◔'}</span>; }
function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} onCancel={onClose}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></div>{children}</dialog>;
}
export default function Crm({customerRoute}:{customerRoute?:{workspace:string;contact:string}}) {
  const router=useRouter();
  const profileWorkspace=customerRoute?.workspace||'';
  const [view,setView] = useState<View>('Overview');
  const [data,setData] = useState<State>(emptyState);
  const [ready,setReady] = useState(false);
  const [email,setEmail] = useState('');
  const [workspaces,setWorkspaces] = useState<Workspace[]>([]);
  const [workspace,setWorkspace] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [editor,setEditor] = useState<Editor>(null);
  const [auth,setAuth] = useState<'signin'|'signup'|null>(null);
  const [recovery,setRecovery] = useState(false);
  const [newWorkspace,setNewWorkspace] = useState(false);
  const [channelHelp,setChannelHelp] = useState<Channel|null>(null);
  const [selected,setSelected] = useState('');
  const [detail,setDetail]=useState<Contact|null>(null);
  const [importing,setImporting]=useState(false),[stageSettings,setStageSettings]=useState(false);
  const [invite,setInvite]=useState('');
  const [recordRevision,setRecordRevision]=useState(0);
  const loadVersion = useRef(0);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const initialWorkspace=profileWorkspace||params.get('workspace')||'';
    const initialView=params.get('view');
    queueMicrotask(()=>setView(profileWorkspace?'Contacts':nav.find(([name])=>name===initialView)?.[0]||'Overview'));
    const invitation=new URLSearchParams(window.location.hash.slice(1)).get('invite');
    if(invitation){sessionStorage.setItem('intouch-invite',invitation);history.replaceState(null,'',window.location.pathname+window.location.search);}
    queueMicrotask(()=>setInvite(sessionStorage.getItem('intouch-invite')||''));
    let disposed = false;
    let stopIdle:undefined|(()=>void);
    let idleUser='';
    const expireSession=()=>{
      idleUser='';
      setNotice('You were signed out after 30 minutes of inactivity. Please sign in again.');
      setAuth('signin');
      void loadSession();
      // Clear the CRM immediately, including when the network is unavailable.
      void supabase?.auth.signOut({scope:'local'}).catch(()=>{});
    };
    const loadSession = async (userEmail?: string) => {
      const version = ++loadVersion.current;
      setDetail(null);setImporting(false);setStageSettings(false);setData(emptyState); setEmail(userEmail||''); setWorkspaces([]); setWorkspace(''); setSelected('');
      if (!userEmail) {setEditor(null);setNewWorkspace(false);setChannelHelp(null);setRecovery(false);setReady(true); return;}
      setReady(false);
      try {
        const list: Workspace[] = await api('/workspaces');
        if (disposed || version!==loadVersion.current) return;
        setWorkspaces(list);
        const target=list.find(item=>item.id===initialWorkspace)||(!profileWorkspace?list[0]:undefined);
        if (target) { const state: State = await api(`/workspaces/${target.id}/snapshot`); if (disposed || version!==loadVersion.current) return; setWorkspace(target.id); setData(state); }
      } catch(e) {if (!disposed) setNotice((e as Error).message);} finally {if (!disposed && version===loadVersion.current) setReady(true);}
    };
    if (!supabase) { queueMicrotask(()=>setReady(true)); return; }
    const {data:subscription} = supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY')setTimeout(()=>{
        if(disposed)return;
        const recovering=session&&(consumePasswordRecovery(session.user.id)||event==='PASSWORD_RECOVERY');
        if(recovering)recordActivity(session.user.id);
        if(session&&isSessionIdle(session.user.id)){stopIdle?.();expireSession();return;}
        if(idleUser!==(session?.user.id||'')){
          stopIdle?.();idleUser=session?.user.id||'';
          stopIdle=session?watchIdleSession(session.user.id,expireSession):undefined;
        }
        if(recovering)setRecovery(true);
        void loadSession(session?.user.email);
      },0);
    });
    return ()=>{disposed=true;stopIdle?.();subscription.subscription.unsubscribe();};
  },[profileWorkspace]);

  async function refresh() {const version=loadVersion.current;const state=await api(`/workspaces/${workspace}/snapshot`);if(version===loadVersion.current){setData(state);setRecordRevision(value=>value+1);}}
  async function mutate(kind:'contacts'|'deals'|'tasks',body:unknown,id?:string,remove=false) {
    if (busy) return; setBusy(true);
    try {
      await api(`/workspaces/${workspace}/${kind}${id?`/${id}`:''}`,remove?'DELETE':id?'PATCH':'POST',remove?undefined:body);
      if(remove&&kind==='contacts'&&id===customerRoute?.contact){setEditor(null);router.push(`/?view=Contacts&workspace=${workspace}`);return;}
      await refresh();
      setEditor(current=>current===editor?null:current);
    } catch(e) {setNotice((e as Error).message);} finally {setBusy(false);}
  }
  async function switchWorkspace(id:string) {
    if(customerRoute){router.push(`/?view=Contacts&workspace=${id}`);return;}
    const version=++loadVersion.current; setDetail(null);setEditor(null);setImporting(false);setStageSettings(false);setWorkspace(id); setData(emptyState); setReady(false); setSelected('');
    try {const state = await api(`/workspaces/${id}/snapshot`); if(version===loadVersion.current) setData(state);} catch(e){setNotice((e as Error).message);} finally {if(version===loadVersion.current)setReady(true);}
  }
  async function submitAuth(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!supabase)return; setBusy(true); setNotice('');
    const form = new FormData(event.currentTarget); const credentials={email:String(form.get('email')),password:String(form.get('password'))};
    try { const result=auth==='signup'?await supabase.auth.signUp({...credentials,options:{emailRedirectTo:window.location.origin}}):await supabase.auth.signInWithPassword(credentials); if(result.error)throw result.error; if(result.data.session)recordActivity(result.data.session.user.id); setAuth(null); if(!result.data.session)setNotice('Check your email to confirm your account, then sign in.'); }
    catch(e){setNotice((e as Error).message);} finally{setBusy(false);}
  }
  async function createWorkspace(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {const {id} = await api('/workspaces','POST',{name:String(new FormData(event.currentTarget).get('name'))}); setWorkspaces(await api('/workspaces')); setNewWorkspace(false); await switchWorkspace(id);} catch(e){setNotice((e as Error).message);} finally{setBusy(false);}
  }
  function submitRecord(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!editor)return;
    const form=new FormData(event.currentTarget); const values=Object.fromEntries(form.entries());
    const body=editor.kind==='contacts'?{...values,birth_month:values.birth_month?Number(values.birth_month):null,birth_day:values.birth_day?Number(values.birth_day):null,birth_year:values.birth_year?Number(values.birth_year):null,tags:String(values.tags||'').split(',').map(t=>t.trim()).filter(Boolean),assigned_to:values.assigned_to||null}:editor.kind==='deals'?{...values,contact_id:values.contact_id||null,value_cents:Math.round(Number(values.value_cents)*100)}:{...values,assigned_to:values.assigned_to||null,contact_id:values.contact_id||null,done:editor.record && 'done' in editor.record ? editor.record.done : false};
    void mutate(editor.kind,body,editor.record?.id);
  }
  function navigate(next:View) {if(customerRoute){router.push(`/?view=${next}&workspace=${workspace}`);return;}setView(next);}
  const contact = (id:string|null) => data.contacts.find(c=>c.id===id);
  const channel = (id:string) => data.channel_connections.find(c=>c.id===id)?.channel || 'WhatsApp';
  const stageRecords=[...data.pipeline_stages].sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
  const stages=stageRecords.map(s=>s.name);
  const openDeals=data.deals.filter(d=>stageRecords.find(s=>s.name===d.stage)?.kind==='open');
  const me=data.members.find(m=>m.email.toLowerCase()===email.toLowerCase());
  const owner=me?.role==='owner';
  const summary=data.summary;
  const openPipelineValue=summary?summary.pipeline.filter(stage=>stage.kind==='open').reduce((total,stage)=>total+stage.value,0):openDeals.reduce((total,deal)=>total+deal.value_cents,0);
  const openPipelineCount=summary?summary.pipeline.filter(stage=>stage.kind==='open').reduce((total,stage)=>total+stage.count,0):openDeals.length;
  const pending=data.tasks.filter(t=>!t.done).sort((a,b)=>a.due_date.localeCompare(b.due_date));
  const workspaceName=workspaces.find(w=>w.id===workspace)?.name||'Your workspace';
  const canEdit=Boolean(workspace&&me&&me.role!=='viewer');

  if(!email) return <div className="auth-shell"><div className="auth-story"><Link className="brand" href="/" aria-label="Touchlumo home"><span className="brand-mark"><Icon name="chat" size={24}/></span>Touch<span>lumo</span><span className="brand-dot">.</span></Link><div><div className="eyebrow">Smarter Connections. Stronger Relationships.</div><h1>Your customers,<br/>a little closer.</h1><p>A private home for your contacts, opportunities, and next steps. Built around the way you do business.</p><div className="auth-features"><span><Icon name="contacts"/>Your own business workspace</span><span><Icon name="pipeline"/>A clear view of every opportunity</span><span><Icon name="tasks"/>Follow-ups that move things forward</span></div></div><small>Your CRM data is securely stored in Supabase.</small></div><section className="auth-card"><div className="auth-appearance"><ThemeSelect/></div><div className="eyebrow">WELCOME TO TOUCHLUMO</div><h2>{auth==='signup'?'Create your account':'Welcome back'}</h2><p>{auth==='signup'?'Start with your own private workspace.':'Sign in to pick up where you left off.'}</p>{notice&&<div className="auth-notice" role="alert">{notice}</div>}{!ready?<p>Connecting to your account…</p>:!supabase?<p role="alert">The Supabase connection is not configured. Configure this application before signing in.</p>:<form onSubmit={submitAuth} className="form-grid"><Field label="Email" name="email" type="email" autoComplete="email" required/><PasswordField key={auth==='signup'?'signup':'signin'} label="Password" name="password" autoComplete={auth==='signup'?'new-password':'current-password'} minLength={10} required/><small>Use at least 10 characters.</small><button className="button primary" disabled={busy}>{busy?'Please wait…':auth==='signup'?'Create account':'Sign in'}</button><button type="button" className="text-button" onClick={()=>{setNotice('');setAuth(auth==='signup'?'signin':'signup');}}>{auth==='signup'?'Already have an account? Sign in':'New here? Create an account'}</button><button type="button" className="text-button" disabled={busy} onClick={async e=>{const form=e.currentTarget.form;const address=String(new FormData(form!).get('email')||'');if(!address){setNotice('Enter your email above to request a password reset.');return;}setBusy(true);try{const {error}=await supabase!.auth.resetPasswordForEmail(address,{redirectTo:window.location.origin});if(error)throw error;setNotice('If an account exists, check your email for a password reset link.');}catch(error){setNotice((error as Error).message);}finally{setBusy(false);}}}>Forgot your password?</button></form>}</section></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="Touchlumo home"><span className="brand-mark"><Icon name="chat" size={24}/></span>Touch<span>lumo</span><span className="brand-dot">.</span></Link>
      <div className="workspace-card"><span className="workspace-icon">{initials(workspaceName)}</span><div><small>WORKSPACE</small>{<select aria-label="Current workspace" value={workspace} onChange={e=>void switchWorkspace(e.target.value)} disabled={!ready||busy}><option value="" disabled>Select workspace</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}</div></div>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav>{nav.map(([label,icon])=><button key={label} className={view===label?'nav-item active':'nav-item'} onClick={()=>navigate(label)}><Icon name={icon}/><span>{label}</span>{label==='Inbox'&&data.conversations.length>0&&<span className="count">{data.conversations.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connect-prompt"><div className="tiny-spark">✧</div><strong>Closer to every customer.</strong><p>Bring your conversations together in one place.</p><button onClick={()=>navigate('Channels')}>Explore channels <Icon name="arrow" size={16}/></button></div>
      <div className="profile"><span className="avatar small">{initials(email)}</span><span className="profile-email"><strong>{email}</strong><button className="text-button" onClick={()=>setNewWorkspace(true)}>New workspace</button></span><button className="icon-button" aria-label="Sign out" onClick={async()=>{const result=await supabase?.auth.signOut(); if(result?.error)setNotice(result.error.message);}}><Icon name="logout" size={17}/></button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{customerRoute?'Customer':view}</strong></div><div className="top-actions"><span className="mode-pill live"><span/>Private workspace</span><AccountMenu email={email} workspaceName={workspaceName} role={me?.role} onNewWorkspace={()=>setNewWorkspace(true)} onChangePassword={()=>{setNotice('');setRecovery(true);}} onSignOut={async()=>{try{const result=await supabase?.auth.signOut();if(result?.error)throw result.error;}catch(error){setNotice((error as Error).message);}}}/></div></header>
      {notice&&<div className="notice" role="alert">{notice}<button className="icon-button" onClick={()=>setNotice('')} aria-label="Dismiss notification"><Icon name="close" size={16}/></button></div>}
      <main>{invite&&<div className="notice"><span>You have a workspace invitation. Sign in with the invited email to accept it.</span><button className="button primary" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await api('/invitations/accept','POST',{token:invite});sessionStorage.removeItem('intouch-invite');setInvite('');setWorkspaces(await api('/workspaces'));await switchWorkspace(result.workspace_id);}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}}>Accept invitation</button><button className="text-button" onClick={()=>{sessionStorage.removeItem('intouch-invite');setInvite('');}}>Dismiss</button></div>}{!customerRoute&&<div className="page-heading"><div><div className="eyebrow">YOUR RELATIONSHIPS, IN FOCUS</div><h1>{view==='Overview'?'A little closer. Every day.':view==='Pipeline'?'Turn conversations into customers.':view==='Channels'?'One inbox. Every conversation.':view}</h1><p>{({Overview:'Good conversations build great businesses. Here’s where yours stand.',Inbox:'Keep the conversation going, wherever it started.',Contacts:'The people at the heart of your business.',Pipeline:'A clear view of every opportunity, from hello to handshake.',Tasks:'Make the next step a thoughtful one.',Reports:'Measure your sales and team workload.',Automations:'Make every next step happen on time.',Quotes:'Create clear proposals for your customers.',Appointments:'Plan your customer meetings.',Tickets:'Give every customer issue a clear next step.',Registration:'Let customers share their details with your business.',Team:'Give your teammates the access they need.',Channels:'Connect your business accounts and meet your customers where they are.'})[view]}</p></div>{canEdit&&['Overview','Contacts','Pipeline','Tasks'].includes(view)&&<button className="button primary" onClick={()=>setEditor({kind:view==='Pipeline'?'deals':view==='Tasks'?'tasks':'contacts'})}><Icon name="plus" size={17}/>{view==='Pipeline'?'New deal':view==='Tasks'?'New task':'Add contact'}</button>}</div>}
      {!ready?<div className="empty">Loading your workspace…</div>:customerRoute?<CustomerPage key={customerRoute.workspace+customerRoute.contact} workspace={customerRoute.workspace} customer={customerRoute.contact} workspaceName={workspaceName} data={data} revision={recordRevision} canEdit={canEdit} owner={owner} email={email} busy={busy} refresh={refresh} onEditContact={record=>setEditor({kind:'contacts',record})} onEditTask={record=>setEditor({kind:'tasks',record})} onEditDeal={record=>setEditor({kind:'deals',record})} onNew={kind=>setEditor({kind,contactId:customerRoute.contact})} onToggle={record=>void mutate('tasks',{done:!record.done},record.id)} onMove={(record,stage)=>void mutate('deals',{stage},record.id)}/>:!workspace?<div className="onboard panel"><span className="large-icon"><Icon name="contacts" size={32}/></span><h2>A home for your customer relationships</h2><p>Create your first business workspace. Its contacts and conversations are visible only to its members.</p><button className="button primary" onClick={()=>setNewWorkspace(true)}>Create workspace</button></div>:<>
      {view==='Overview'&&<>
        <div className="stats-grid">{[{label:'Total contacts',value:summary?.contacts??data.contacts.length,icon:'contacts',sub:`${summary?.customers??data.contacts.filter(c=>c.status==='Customer').length} customer relationships`},{label:'Open conversations',value:summary?.openConversations??data.conversations.filter(c=>c.status==='Open').length,icon:'chat',sub:'Across your connected channels'},{label:'Pipeline value',value:money(openPipelineValue),icon:'pipeline',sub:`${openPipelineCount} opportunities in progress`},{label:'To follow up',value:summary?.openTasks??pending.length,icon:'tasks',sub:'Small steps. Stronger connections.'}].map(stat=><div className="stat-card" key={stat.label}><div className="stat-top">{stat.label}<Icon name={stat.icon} size={19}/></div><div className="stat-value">{stat.value}</div><small>{stat.sub}</small></div>)}</div>
        <div className="overview-grid"><section className="panel"><div className="section-heading"><div><h2>Recent conversations</h2><p>A good time to say hello.</p></div><button className="text-button" onClick={()=>navigate('Inbox')}>View inbox <Icon name="arrow" size={15}/></button></div>{data.conversations.length===0?<div className="empty">Connect a channel to start receiving conversations.</div>:data.conversations.slice(0,5).map(c=>{const person=contact(c.contact_id);const last=data.messages.filter(m=>m.conversation_id===c.id).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];return <button className="conversation-row" key={c.id} onClick={()=>{setSelected(c.id);navigate('Inbox');}}><span className="avatar">{initials(person?.name||'?')}</span><span className="conversation-summary"><strong>{person?.name}</strong><span>{last?.body||'No messages yet'}</span></span><ChannelBadge channel={channel(c.connection_id)}/><Icon name="arrow" size={16}/></button>;})}</section>
        <section className="panel followup"><div className="section-heading"><div><h2>Your next moves</h2><p>A little follow-through goes a long way.</p></div><span className="soft-count">{summary?.openTasks??pending.length}</span></div>{pending.length?pending.slice(0,4).map(t=><label className="task-row" key={t.id}><input type="checkbox" checked={t.done} disabled={busy||!canEdit} onChange={()=>void mutate('tasks',{done:!t.done},t.id)}/><span><strong>{t.title}</strong><small>{contact(t.contact_id)?.name||'General task'} · {t.due_date}</small></span></label>):<div className="empty">You’re all caught up.</div>}<button className="add-task" disabled={!canEdit} onClick={()=>setEditor({kind:'tasks'})}><Icon name="plus" size={16}/>Add a follow-up</button></section></div>
        <section className="channel-strip"><div className="channel-art">{channels.map(c=><ChannelBadge key={c} channel={c}/>)}</div><div><h2>Different channels. One human connection.</h2><p>Your WhatsApp, Messenger, and Instagram conversations, together.</p></div><button className="button secondary" onClick={()=>navigate('Channels')}>Manage channels <Icon name="arrow" size={16}/></button></section>
        <section className="panel pipeline-preview"><div className="section-heading"><div><h2>Your pipeline at a glance</h2><p>Every opportunity starts with a conversation.</p></div><button className="text-button" onClick={()=>navigate('Pipeline')}>View pipeline <Icon name="arrow" size={15}/></button></div><div className="stage-summary">{stages.map((s,i)=>{const deals=data.deals.filter(d=>d.stage===s);const totals=summary?.pipeline.find(stage=>stage.name===s);return <div key={s}><span className={`stage-dot stage-${i}`}/><span>{s}</span><strong>{money(totals?.value??deals.reduce((n,d)=>n+d.value_cents,0))}</strong><small>{totals?.count??deals.length} deals</small></div>;})}</div></section>
      </>}
      {view==='Reports'&&<Reports key={workspace} workspace={workspace}/>}
      {(['Automations','Quotes','Appointments','Tickets'] as string[]).includes(view)&&<BusinessModule key={workspace+view} kind={view.toLowerCase() as 'automations'|'quotes'|'appointments'|'tickets'} workspace={workspace} workspaceName={workspaceName} data={data} canEdit={canEdit} owner={owner} refresh={refresh}/>}
      {view==='Registration'&&<RegistrationManager key={workspace} workspace={workspace} owner={owner} canEdit={canEdit} refresh={refresh}/>}
      {view==='Team'&&<Team key={workspace} workspace={workspace} members={data.members} owner={owner} refresh={refresh}/>}
      {view==='Contacts'&&canEdit&&<div className="workflow-toolbar"><button className="button secondary" onClick={()=>setImporting(true)}>Import CSV</button></div>}
      {view==='Pipeline'&&owner&&<div className="workflow-toolbar"><button className="button secondary" onClick={()=>setStageSettings(true)}>Manage stages</button></div>}
      {view==='Contacts'&&<ContactsList key={workspace} workspace={workspace} revision={recordRevision} canEdit={canEdit} onDetails={setDetail} onEdit={record=>setEditor({kind:'contacts',record})}/>}
      {view==='Pipeline'&&<PipelineBoard key={workspace} workspace={workspace} revision={recordRevision} stages={stageRecords} canEdit={canEdit} busy={busy} onEdit={record=>setEditor({kind:'deals',record})} onMove={(record,stage)=>void mutate('deals',{stage},record.id)} onNew={()=>setEditor({kind:'deals'})}/>}
      {view==='Tasks'&&<TasksList key={workspace} workspace={workspace} revision={recordRevision} canEdit={canEdit} busy={busy} members={data.members} onEdit={record=>setEditor({kind:'tasks',record})} onToggle={record=>void mutate('tasks',{done:!record.done},record.id)}/>}
      {view==='Channels'&&<><WhatsAppConnections key={workspace} workspace={workspace} refresh={refresh}/><div className="channel-grid">{channels.filter((c):boolean=>c!=='WhatsApp').map(c=><section className="panel channel-card" key={c}><ChannelBadge channel={c}/><span className="status">Not connected</span><h2>{c==='Facebook'?'Facebook Messenger':c}</h2><p>{c==='WhatsApp'?'Build lasting relationships through your WhatsApp Business number.':c==='Facebook'?'Keep every conversation from your Facebook Page in one place.':'Turn interest into relationships through your professional account.'}</p><div className="channel-requirement">{c==='WhatsApp'?'WhatsApp Business account':c==='Facebook'?'Facebook Page':'Instagram professional account'}</div><button className="button secondary" onClick={()=>setChannelHelp(c)}>View connection setup <Icon name="arrow" size={16}/></button></section>)}</div><section className="panel connection-note"><Icon name="contacts" size={24}/><div><h2>Your accounts. Your relationships.</h2><p>Each business will authorize its own accounts. Connection metadata is scoped to your workspace. Live authorization and message delivery are the next integration milestone.</p></div></section></>}
      {view==='Inbox'&&<WhatsAppInbox key={workspace} workspace={workspace} canEdit={canEdit} initialConversation={selected}/>}
      </>}
      <footer>Smarter Connections. Stronger Relationships.<span>Touchlumo · Your business workspace</span></footer>
      </main>
    </div>
    {detail&&<Modal title={detail.name} onClose={()=>setDetail(null)}><ContactDetails workspace={workspace} contact={detail} members={data.members} canEdit={canEdit} owner={owner} email={email}/></Modal>}
    {importing&&<Modal title="Import contacts" onClose={()=>setImporting(false)}><CsvImport workspace={workspace} refresh={refresh}/></Modal>}
    {stageSettings&&<Modal title="Pipeline stages" onClose={()=>setStageSettings(false)}><StageSettings workspace={workspace} stages={stageRecords} refresh={refresh}/></Modal>}
    {editor&&<Modal title={`${editor.record?'Edit':'New'} ${editor.kind==='contacts'?'contact':editor.kind==='deals'?'deal':'task'}`} onClose={()=>{if(!busy)setEditor(null);}}><form onSubmit={submitRecord} className="form-grid">
      {editor.kind==='contacts'?<><Field label="Full name" name="name" defaultValue={(editor.record as Contact)?.name} required/><Field label="Email" name="email" type="email" defaultValue={(editor.record as Contact)?.email}/><Field label="Phone" name="phone" defaultValue={(editor.record as Contact)?.phone}/><Field label="Company" name="company" defaultValue={(editor.record as Contact)?.company}/><BirthdayFields contact={editor.record as Contact}/><PreferredChannel value={(editor.record as Contact)?.preferred_channel}/><Field label="Website" name="website" type="url" defaultValue={(editor.record as Contact)?.website}/><Field label="Tags (comma separated)" name="tags" defaultValue={(editor.record as Contact)?.tags?.join(', ')}/><label>Status<select aria-label="Status" name="status" defaultValue={(editor.record as Contact)?.status||'Lead'}>{['Lead','Customer','Inactive'].map(s=><option key={s}>{s}</option>)}</select></label></>:<><Field label="Title" name="title" defaultValue={(editor.record as Deal|Task)?.title} required/><ContactPicker workspace={workspace} defaultValue={(editor.record as Deal|Task)?.contact_id||editor.contactId||''}/>{editor.kind==='deals'?<><Field label="Value (USD)" name="value_cents" type="number" min="0" max="1000000000" step="0.01" defaultValue={((editor.record as Deal)?.value_cents||0)/100} required/><label>Stage<select aria-label="Stage" name="stage" defaultValue={(editor.record as Deal)?.stage||stages[0]}>{stages.map(s=><option key={s}>{s}</option>)}</select></label></>:<Field label="Due date" name="due_date" type="date" defaultValue={(editor.record as Task)?.due_date||new Date().toISOString().slice(0,10)} required/>}</>}
      {editor.kind!=='deals'&&<label>Assigned to<select aria-label="Assigned to" name="assigned_to" defaultValue={(editor.record as Contact|Task)?.assigned_to||''}><option value="">Unassigned</option>{data.members.filter(m=>m.role!=='viewer').map(m=><option key={m.user_id} value={m.user_id}>{m.email}</option>)}</select></label>}
      {notice&&<p role="alert">{notice}</p>}<div className="form-actions">{editor.record&&<button type="button" disabled={busy} className="text-button danger" onClick={()=>{if(window.confirm('Delete this record? This cannot be undone.'))void mutate(editor.kind,{},editor.record?.id,true);}}>Delete</button>}<button className="button primary" disabled={busy} type="submit">{busy?'Saving…':'Save changes'}</button></div></form></Modal>}
    {recovery&&<Modal title="Set a new password" onClose={()=>setRecovery(false)}><form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);const password=String(new FormData(e.currentTarget).get('password'));try{const {error}=await supabase!.auth.updateUser({password});if(error)throw error;setRecovery(false);setNotice('Your password has been updated.');}catch(error){setNotice((error as Error).message);}finally{setBusy(false);}}}><PasswordField label="New password" name="password" autoComplete="new-password" minLength={10} required/>{notice&&<p role="alert">{notice}</p>}<button className="button primary" disabled={busy}>Update password</button></form></Modal>}
    {newWorkspace&&<Modal title="Create a business workspace" onClose={()=>setNewWorkspace(false)}><form onSubmit={createWorkspace} className="form-grid">{notice&&<p role="alert">{notice}</p>}<Field label="Business name" name="name" maxLength={100} required/><p>Your workspace starts empty. Contacts, deals, and tasks are stored in your private Supabase workspace.</p><button className="button primary" disabled={busy}>Create workspace</button></form></Modal>}
    {channelHelp&&<Modal title={`Connect ${channelHelp}`} onClose={()=>setChannelHelp(null)}><div className="setup-message"><ChannelBadge channel={channelHelp}/><h3>Meta connection required</h3><p>Your CRM is connected to Supabase. To send and receive messages, the Meta developer application and its account authorization flow still need to be configured.</p><p>When available, each business owner will connect their own {channelHelp==='WhatsApp'?'WhatsApp Business account':channelHelp==='Facebook'?'Facebook Page':'Instagram professional account'} through Meta.</p><button className="button primary" onClick={()=>setChannelHelp(null)}>Got it</button></div></Modal>}
  </div>;
}
function Field({label,...props}:{label:string}&React.InputHTMLAttributes<HTMLInputElement>) {return <label>{label}<input maxLength={300} {...props}/></label>;}
