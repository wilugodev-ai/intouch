export type Contact = {id: string; name: string; email: string; phone: string; company: string; status: 'Lead'|'Customer'|'Inactive'};
export type Deal = {id: string; title: string; contact_id: string|null; value_cents: number; stage: string};
export type Task = {id: string; title: string; contact_id: string|null; due_date: string; done: boolean};
export type Channel = 'WhatsApp'|'Facebook'|'Instagram';
export type Conversation = {id: string; contact_id: string; connection_id: string; status: string};
export type Message = {id: string; conversation_id: string; body: string; direction: string; created_at: string};
export type Connection = {id: string; channel: Channel; display_name: string; status: string};
export type State = {contacts: Contact[]; deals: Deal[]; tasks: Task[]; conversations: Conversation[]; messages: Message[]; channel_connections: Connection[]};
export const emptyState: State = {contacts: [], deals: [], tasks: [], conversations: [], messages: [], channel_connections: []};
export const channels: Channel[] = ['WhatsApp','Facebook','Instagram'];
export const stages = ['New','Qualified','Proposal','Won','Lost'];
export const money = (cents: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
export const initials = (name: string) => name.split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
export function seed(): State {
  const today = new Date().toISOString().slice(0,10);
  const contacts: Contact[] = [
    {id:'c1',name:'Sofia Martinez',email:'sofia@example.com',phone:'+1 202 555 0114',company:'Bloom Studio',status:'Lead'},
    {id:'c2',name:'James Wilson',email:'james@example.com',phone:'+1 202 555 0198',company:'North & Co.',status:'Customer'},
    {id:'c3',name:'Olivia Chen',email:'olivia@example.com',phone:'+1 202 555 0126',company:'Forma Living',status:'Lead'},
    {id:'c4',name:'Lucas Thompson',email:'lucas@example.com',phone:'',company:'Sunday Coffee',status:'Lead'},
    {id:'c5',name:'Amara Okafor',email:'amara@example.com',phone:'',company:'Kindred Goods',status:'Customer'},
  ];
  const bodies = ['Hi! I’d love to learn more about your services. Do you have time for a quick chat?','Thanks for the proposal. Everything looks great!','Can you send me a few more details about the premium package?','Hi there! Are you taking on new projects this month?','Perfect, thank you for the update!'];
  return {
    contacts,
    deals:[{id:'d1',title:'Brand studio partnership',contact_id:'c1',value_cents:450000,stage:'New'},{id:'d2',title:'Spring collection launch',contact_id:'c3',value_cents:820000,stage:'Qualified'},{id:'d3',title:'Monthly creative retainer',contact_id:'c2',value_cents:300000,stage:'Proposal'},{id:'d4',title:'Website refresh',contact_id:'c5',value_cents:620000,stage:'Won'}],
    tasks:[{id:'t1',title:'Send Sofia the service guide',contact_id:'c1',due_date:today,done:false},{id:'t2',title:'Follow up on the spring collection',contact_id:'c3',due_date:today,done:false},{id:'t3',title:'Prepare James’s kickoff notes',contact_id:'c2',due_date:today,done:true}],
    channel_connections:channels.map((channel,i)=>({id:`ch${i}`,channel,display_name:'Sample business',status:'demo'})),
    conversations:contacts.map((c,i)=>({id:`cv${i}`,contact_id:c.id,connection_id:`ch${i%3}`,status:'Open'})),
    messages:contacts.map((c,i)=>({id:`m${i}`,conversation_id:`cv${i}`,body:bodies[i],direction:'inbound',created_at:new Date(Date.now()-(i+1)*600000).toISOString()})),
  };
}
