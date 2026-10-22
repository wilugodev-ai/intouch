'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/client';
type Choice={id:string;name:string};
export default function ContactPicker({workspace,defaultValue='',label='Contact'}:{workspace:string;defaultValue?:string;label?:string}) {
  const [selected,setSelected]=useState(defaultValue),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [options,setOptions]=useState<Choice[]>([]),[current,setCurrent]=useState<Choice|null>(null),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    if(!defaultValue)return;
    let disposed=false;
    void api(`/workspaces/${workspace}/records/contacts?id=${encodeURIComponent(defaultValue)}`).then(result=>{if(!disposed)setCurrent(result.rows[0]||null);}).catch(()=>{});
    return()=>{disposed=true;};
  },[workspace,defaultValue]);
  useEffect(()=>{
    let disposed=false;
    const timer=setTimeout(async()=>{
      setLoading(true);setError('');
      try{const params=new URLSearchParams({search,page:String(page),pageSize:'25'});const result=await api(`/workspaces/${workspace}/records/contacts?${params}`);if(disposed)return;setOptions(previous=>page===0?result.rows:[...new Map([...previous,...result.rows].map((item:Choice)=>[item.id,item])).values()]);setTotal(result.total);}
      catch(error){if(!disposed)setError((error as Error).message);}finally{if(!disposed)setLoading(false);}
    },search?200:0);
    return()=>{disposed=true;clearTimeout(timer);};
  },[workspace,search,page]);
  const choices=current&&!options.some(option=>option.id===current.id)?[current,...options]:options;
  return <div className="contact-picker"><label>Find a {label.toLowerCase()}<input aria-label={`Find a ${label.toLowerCase()}`} type="search" maxLength={150} placeholder="Search all customers…" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);setOptions([]);setLoading(true);}}/></label><label>{label}<select aria-label={label} name="contact_id" value={selected} onChange={event=>{setSelected(event.target.value);setCurrent(choices.find(option=>option.id===event.target.value)||null);}}><option value="">No linked contact</option>{selected&&!choices.some(option=>option.id===selected)&&<option value={selected}>Selected contact</option>}{choices.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>{loading?<small role="status">Loading contacts…</small>:error?<small role="alert">{error}</small>:<small>{options.length} of {total} matching contacts</small>}{!loading&&options.length<total&&<button className="text-button" type="button" onClick={()=>{setLoading(true);setPage(value=>value+1);}}>More contacts</button>}</div>;
}
