'use client';
import {useEffect, useState} from 'react';
import {api} from '../lib/client';
import {initials, money, type Contact, type Deal, type Task, type Stage, type Member} from '../lib/data';
import Icon from './symbol';
import Link from 'next/link';

type Kind = 'contacts'|'deals'|'tasks';
type Linked<T> = T & {contact?: {id:string;name:string}|null};
type Result<T> = {rows:T[];total:number;page:number;pageSize:number};
function useRecords<T>(workspace:string, kind:Kind, revision:number, stage='', initialSearch='', customer='') {
  const [query,setQuery]=useState({search:initialSearch,page:0,filter:'all'});
  const [retry,setRetry]=useState(0);
  const [result,setResult]=useState<{key:string;data?:Result<T>;error?:string}|null>(null);
  const pageSize=kind==='deals'?10:25;
  const params=new URLSearchParams({page:String(query.page),pageSize:String(pageSize),search:query.search});
  if(stage)params.set('stage',stage);
  if(customer)params.set('contact',customer);
  if(kind==='tasks'){params.set('filter',query.filter);params.set('today',new Date().toLocaleDateString('en-CA'));}
  const url=`/workspaces/${workspace}/records/${kind}?${params}`;
  const key=`${url}|${revision}|${retry}`;
  useEffect(()=>{
    let disposed=false;
    const timer=setTimeout(async()=>{
      try {
        const data:Result<T>=await api(url);
        if(disposed)return;
        const last=Math.max(0,Math.ceil(data.total/pageSize)-1);
        if(query.page>last){setQuery(current=>({...current,page:last}));return;}
        setResult({key,data});
      } catch(error){if(!disposed)setResult({key,error:(error as Error).message});}
    },query.search?200:0);
    return()=>{disposed=true;clearTimeout(timer);};
  },[url,key,pageSize,query.page,query.search]);
  const current=result?.key===key?result:null;
  return {rows:current?.data?.rows||[],total:current?.data?.total||0,loading:!current,error:current?.error,pageSize,query,
    search:(value:string)=>setQuery(current=>({...current,search:value,page:0})),
    filter:(value:string)=>setQuery(current=>({...current,filter:value,page:0})),
    page:(value:number)=>setQuery(current=>({...current,page:value})),retry:()=>setRetry(value=>value+1)};
}
function Search({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  return <label className="search"><Icon name="search" size={17}/><input aria-label="Search" placeholder="Search…" maxLength={150} value={value} onChange={event=>onChange(event.target.value)}/></label>;
}
function Pagination({page,pageSize,total,loading,onChange,label}:{page:number;pageSize:number;total:number;loading:boolean;onChange:(page:number)=>void;label:string}) {
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <nav className="pagination" aria-label={label}><button className="button secondary" disabled={loading||page===0} onClick={()=>onChange(page-1)}>Previous</button><span role="status">{loading?'Loading…':`${total? page*pageSize+1:0}–${Math.min((page+1)*pageSize,total)} of ${total} · Page ${page+1} of ${pages}`}</span><button className="button secondary" disabled={loading||page+1>=pages} onClick={()=>onChange(page+1)}>Next</button></nav>;
}
function ErrorNotice({message,retry}:{message:string;retry:()=>void}){return <div className="record-list-message" role="alert">{message} <button className="text-button" onClick={retry}>Try again</button></div>;}

export function ContactsList({workspace,revision,canEdit,onDetails,onEdit}:{workspace:string;revision:number;canEdit:boolean;onDetails:(contact:Contact)=>void;onEdit:(contact:Contact)=>void}) {
  const list=useRecords<Contact>(workspace,'contacts',revision);
  return <section className="panel" aria-busy={list.loading}><div className="section-heading"><h2>All contacts <span className="soft-count">{list.loading?'…':list.total}</span></h2><Search value={list.query.search} onChange={list.search}/></div><p className="record-list-help">Search all contacts by name, email, phone, company, or an exact tag.</p>
    {list.error?<ErrorNotice message={list.error} retry={list.retry}/>:list.loading?<div className="empty">Loading contacts…</div>:<><div className="table-scroll"><table><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th><th/></tr></thead><tbody>{list.rows.map(contact=><tr key={contact.id}><td><div className="person-cell"><span className="avatar small">{initials(contact.name)}</span><button className="text-button" onClick={()=>onDetails(contact)}>{contact.name}</button></div></td><td>{contact.company||'—'}</td><td>{contact.email||'—'}</td><td><span className={`status ${contact.status.toLowerCase()}`}>{contact.status}</span></td><td><div className="row-actions"><Link className="text-button" href={`/customers/${workspace}/${contact.id}`} prefetch={false} aria-label={`Open page for ${contact.name}`}>Open page</Link><button disabled={!canEdit} className="text-button" onClick={()=>onEdit(contact)}>Edit</button></div></td></tr>)}</tbody></table></div>{!list.rows.length&&<div className="empty">{list.query.search?'No contacts match your search.':'Add your first contact to get started.'}</div>}</>}
    <Pagination label="Contacts pages" page={list.query.page} pageSize={list.pageSize} total={list.total} loading={list.loading} onChange={list.page}/>
  </section>;
}
export function TasksList({workspace,revision,canEdit,busy,members,onEdit,onToggle,customer=''}:{customer?:string;workspace:string;revision:number;canEdit:boolean;busy:boolean;members:Member[];onEdit:(task:Task)=>void;onToggle:(task:Task)=>void}) {
  const list=useRecords<Linked<Task>>(workspace,'tasks',revision,'','',customer);
  const today=new Date().toLocaleDateString('en-CA');
  return <section className="panel" aria-busy={list.loading}><div className="section-heading"><label className="record-filter">Show<select aria-label="Filter tasks" value={list.query.filter} onChange={event=>list.filter(event.target.value)}>{[['all','All'],['assigned','Assigned to me'],['overdue','Overdue'],['today','Today'],['open','Open'],['completed','Completed']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><h2>Follow-ups</h2><Search value={list.query.search} onChange={list.search}/></div>
    {list.error?<ErrorNotice message={list.error} retry={list.retry}/>:list.loading?<div className="empty">Loading follow-ups…</div>:list.rows.length?list.rows.map(task=><div className="task-row full" key={task.id}><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.done} disabled={busy||!canEdit} onChange={()=>onToggle(task)}/><span className={task.done?'completed':''}><strong>{task.title}</strong><small>{task.contact?.name||'General task'}</small></span><span className="due-date">{!task.done&&task.due_date<today?'Overdue · ':''}{task.due_date}<small>{members.find(member=>member.user_id===task.assigned_to)?.email||'Unassigned'}</small></span><button disabled={!canEdit} className="text-button" onClick={()=>onEdit(task)}>Edit</button></div>):<div className="empty">No tasks match your search and filter.</div>}
    <Pagination label="Follow-up pages" page={list.query.page} pageSize={list.pageSize} total={list.total} loading={list.loading} onChange={list.page}/>
  </section>;
}
function DealColumn({workspace,revision,stage,stages,index,search,canEdit,busy,onEdit,onMove,onNew,customer=''}:{customer?:string;workspace:string;revision:number;stage:Stage;stages:Stage[];index:number;search:string;canEdit:boolean;busy:boolean;onEdit:(deal:Deal)=>void;onMove:(deal:Deal,stage:string)=>void;onNew:()=>void}) {
  const list=useRecords<Linked<Deal>>(workspace,'deals',revision,stage.name,search,customer);
  return <section className="kanban-column" aria-busy={list.loading}><div className="kanban-heading"><span className={`stage-dot stage-${index}`}/><h2>{stage.name}</h2><span>{list.loading?'…':list.total}</span></div>
    {list.error?<ErrorNotice message={list.error} retry={list.retry}/>:list.loading?<div className="empty">Loading deals…</div>:list.rows.map(deal=><article className="deal-card" key={deal.id}><button disabled={!canEdit} className="deal-title" onClick={()=>onEdit(deal)}>{deal.title}</button><p>{deal.contact?.name||'No linked contact'}</p><strong>{money(deal.value_cents)}</strong><select aria-label={`Stage for ${deal.title}`} value={deal.stage} disabled={busy||!canEdit} onChange={event=>onMove(deal,event.target.value)}>{stages.map(option=><option key={option.name}>{option.name}</option>)}</select></article>)}
    <Pagination label={`${stage.name} deal pages`} page={list.query.page} pageSize={list.pageSize} total={list.total} loading={list.loading} onChange={list.page}/><button className="add-task" disabled={!canEdit} onClick={onNew}><Icon name="plus" size={14}/>New deal</button>
  </section>;
}
export function PipelineBoard({workspace,revision,stages,canEdit,busy,onEdit,onMove,onNew,customer=''}:{customer?:string;workspace:string;revision:number;stages:Stage[];canEdit:boolean;busy:boolean;onEdit:(deal:Deal)=>void;onMove:(deal:Deal,stage:string)=>void;onNew:()=>void}) {
  const [search,setSearch]=useState('');
  return <><div className="workflow-toolbar"><Search value={search} onChange={setSearch}/></div><div className="kanban">{stages.map((stage,index)=><DealColumn key={`${stage.name}:${search}`} workspace={workspace} revision={revision} stage={stage} stages={stages} index={index} search={search} canEdit={canEdit} busy={busy} onEdit={onEdit} onMove={onMove} onNew={onNew} customer={customer}/>)}</div></>;
}
