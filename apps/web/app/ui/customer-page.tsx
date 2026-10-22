'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {api} from '../lib/client';
import {initials,type Contact,type Deal,type Task,type State} from '../lib/data';
import {ContactDetails} from './workflows';
import {ConsentDetails} from './customer-fields';
import CustomerAttachments from './customer-attachments';
import {WhatsAppInbox} from './whatsapp';
import {TasksList,PipelineBoard} from './core-records';
import {BusinessModule} from './business';

type Section='Overview'|'WhatsApp'|'Activity'|'Files and documents'|'Tasks'|'Deals'|'Quotes'|'Appointments'|'Tickets';
const sections:Section[]=['Overview','Activity','WhatsApp','Files and documents','Tasks','Deals','Quotes','Appointments','Tickets'];
type Profile={contact:Contact;counts:{openTasks:number;deals:number;quotes:number;appointments:number;tickets:number}};
type Props={workspace:string;customer:string;workspaceName:string;data:State;revision:number;canEdit:boolean;owner:boolean;email:string;busy:boolean;refresh:()=>Promise<void>;onEditContact:(contact:Contact)=>void;onEditTask:(task:Task)=>void;onEditDeal:(deal:Deal)=>void;onNew:(kind:'tasks'|'deals')=>void;onToggle:(task:Task)=>void;onMove:(deal:Deal,stage:string)=>void};
export default function CustomerPage({workspace,customer,workspaceName,data,revision,canEdit,owner,email,busy,refresh,onEditContact,onEditTask,onEditDeal,onNew,onToggle,onMove}:Props){
  const [section,setSection]=useState<Section>('Overview');
  const [retry,setRetry]=useState(0),[result,setResult]=useState<{key:string;data?:Profile;error?:string}|null>(null);
  const key=`${workspace}/${customer}/${revision}/${retry}`;
  useEffect(()=>{let disposed=false;api(`/crm/${workspace}/contacts/${customer}/profile`).then((profile:Profile)=>{if(!disposed)setResult({key,data:profile});}).catch(error=>{if(!disposed)setResult({key,error:error.message});});return()=>{disposed=true;};},[workspace,customer,key]);
  const current=result?.key.startsWith(`${workspace}/${customer}/`)?result:null,profile=current?.data,person=profile?.contact;
  const stages=[...data.pipeline_stages].sort((a,b)=>a.position-b.position||a.name.localeCompare(b.name));
  return <div className="customer-page">
    <Link className="text-button customer-back" href={`/?view=Contacts&workspace=${workspace}`}>Back to contacts</Link>
    {current?.error?<section className="panel customer-message" role="alert"><h1>Customer unavailable</h1><p>{current.error}</p><button className="button secondary" onClick={()=>setRetry(value=>value+1)}>Try again</button></section>:!person||!profile?<p className="customer-message" role="status">Loading customer page...</p>:<>
      <header className="customer-heading"><div className="customer-identity"><span className="avatar customer-avatar">{initials(person.name)}</span><div><div className="eyebrow">CUSTOMER WORKSPACE</div><h1>{person.name}</h1><p>{person.company||'Individual customer'} <span className={`status ${person.status.toLowerCase()}`}>{person.status}</span></p></div></div><div className="customer-heading-actions"><button className="button secondary" disabled={busy} onClick={()=>void refresh().catch(()=>setRetry(value=>value+1))}>Refresh customer</button>{canEdit&&<button className="button primary" disabled={busy} onClick={()=>onEditContact(person)}>Edit customer</button>}</div></header>
      <nav className="customer-sections" aria-label="Customer sections">{sections.map(name=><button type="button" key={name} aria-current={section===name?'page':undefined} onClick={()=>setSection(name)}>{name}</button>)}</nav>
      <section className="customer-section" aria-label={`Customer ${section.toLowerCase()}`}>
        {section==='Overview'&&<>
          <div className="customer-metrics">{([['Open tasks',profile.counts.openTasks,'Tasks'],['Deals',profile.counts.deals,'Deals'],['Quotes',profile.counts.quotes,'Quotes'],['Upcoming appointments',profile.counts.appointments,'Appointments'],['Open tickets',profile.counts.tickets,'Tickets']] as [string,number,Section][]).map(([label,count,destination])=><button className="panel customer-metric" key={label} onClick={()=>setSection(destination)}><span>{label}</span><strong>{count}</strong><small>View {destination.toLowerCase()}</small></button>)}</div>
          <div className="customer-overview-grid"><section className="panel customer-info"><h2>Contact details</h2><dl><div><dt>Email</dt><dd>{person.email?<a href={`mailto:${person.email}`}>{person.email}</a>:'Not provided'}</dd></div><div><dt>Phone</dt><dd>{person.phone?<a href={`tel:${person.phone}`}>{person.phone}</a>:'Not provided'}</dd></div><div><dt>Company</dt><dd>{person.company||'Not provided'}</dd></div><div><dt>Website</dt><dd>{person.website?<a href={person.website} target="_blank" rel="noreferrer">{person.website}</a>:'Not provided'}</dd></div><div><dt>Assigned to</dt><dd>{data.members.find(member=>member.user_id===person.assigned_to)?.email||'Unassigned'}</dd></div></dl><div className="tags">{person.tags.length?person.tags.map(tag=><span className="status" key={tag}>{tag}</span>):<small>No tags yet.</small>}</div></section>
          <section className="panel customer-info"><ConsentDetails key={person.id+revision} workspace={workspace} contact={person} canEdit={canEdit}/></section></div>
          {canEdit&&<section className="panel customer-info"><h2>Next steps</h2><p>Add the next action for {person.name}.</p><div className="customer-heading-actions"><button className="button primary" onClick={()=>onNew('tasks')}>New task</button><button className="button secondary" onClick={()=>onNew('deals')}>New deal</button><button className="button secondary" onClick={()=>setSection('Appointments')}>Plan an appointment</button></div></section>}
        </>}
        {section==='WhatsApp'&&<WhatsAppInbox key={person.id} workspace={workspace} customer={person.id} canEdit={canEdit}/>}
        {section==='Activity'&&<section className="panel customer-info"><ContactDetails key={person.id+revision} workspace={workspace} contact={person} members={data.members} canEdit={canEdit} email={email} owner={owner} activityOnly/></section>}
        {section==='Files and documents'&&<section className="panel customer-info"><CustomerAttachments workspace={workspace} contact={person.id} canEdit={canEdit}/></section>}
        {section==='Tasks'&&<><div className="workflow-toolbar"><h2>Customer tasks</h2>{canEdit&&<button className="button primary" onClick={()=>onNew('tasks')}>New task</button>}</div><TasksList key={person.id} customer={person.id} workspace={workspace} revision={revision} canEdit={canEdit} busy={busy} members={data.members} onEdit={onEditTask} onToggle={onToggle}/></>}
        {section==='Deals'&&<><div className="workflow-toolbar"><h2>Customer deals</h2></div><PipelineBoard key={person.id} customer={person.id} workspace={workspace} revision={revision} stages={stages} canEdit={canEdit} busy={busy} onEdit={onEditDeal} onMove={onMove} onNew={()=>onNew('deals')}/></>}
        {(['Quotes','Appointments','Tickets'] as Section[]).includes(section)&&<BusinessModule key={person.id+section} kind={section.toLowerCase() as 'quotes'|'appointments'|'tickets'} customer={person} workspace={workspace} workspaceName={workspaceName} data={data} canEdit={canEdit} owner={owner} refresh={refresh}/>}
      </section>
    </>}
  </div>;
}