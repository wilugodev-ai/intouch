import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url,key) : null;
export async function api(path: string, method = 'GET', body?: unknown) {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error('Sign in to continue');
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:4100'}/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
  return data;
}
