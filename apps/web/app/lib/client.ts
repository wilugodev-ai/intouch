import { createClient } from '@supabase/supabase-js';
import { isSessionIdle } from './idle-session';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url,key) : null;
// URL recovery can finish before React mounts; capture that one-time event early.
let recoveryUserId:string|null=null;
supabase?.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY')recoveryUserId=session?.user.id??null;
  if(event==='SIGNED_OUT')recoveryUserId=null;
});
export function consumePasswordRecovery(userId:string) {
  if(recoveryUserId!==userId)return false;
  recoveryUserId=null;
  return true;
}
export async function api(path: string, method = 'GET', body?: unknown) {
  const session = await supabase?.auth.getSession();
  if(session?.data.session&&isSessionIdle(session.data.session.user.id))throw new Error('You were signed out after 30 minutes of inactivity. Please sign in again.');
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('Sign in to continue');
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4100'}/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
  return data;
}

export async function apiFile(path:string, options:RequestInit={}) {
  const session=await supabase?.auth.getSession();
  if(session?.data.session&&isSessionIdle(session.data.session.user.id))throw new Error('You were signed out after 30 minutes of inactivity. Please sign in again.');
  const token=session?.data.session?.access_token;
  if(!token)throw new Error('Sign in to continue');
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
  const response=await fetch(`${process.env.NEXT_PUBLIC_API_URL||'http://127.0.0.1:4100'}/v1${path}`,{...options,headers,cache:'no-store'});
  if(!response.ok){let message='The file operation failed. Please try again.';try{const data=await response.json();if(typeof data.message==='string')message=data.message;}catch{}throw new Error(message);}
  return response;
}
