export const IDLE_TIMEOUT_MS=30*60*1000;
const memory=new Map<string,number>();
const key=(userId:string)=>`intouch:last-activity:${userId}`;

function lastActivity(userId:string) {
  try {
    const value=Number(localStorage.getItem(key(userId)));
    if(Number.isFinite(value)&&value>0)return value;
  } catch { /* Keep the timer working when browser storage is unavailable. */ }
  return memory.get(userId);
}

export function recordActivity(userId:string) {
  const now=Date.now();
  memory.set(userId,now);
  try {localStorage.setItem(key(userId),String(now));} catch { /* Use the in-memory timestamp. */ }
}

export function isSessionIdle(userId:string) {
  const last=lastActivity(userId);
  return last!==undefined&&Date.now()-last>=IDLE_TIMEOUT_MS;
}

// Auth refreshes, reloads, and simply focusing a tab do not count as activity.
export function watchIdleSession(userId:string,onExpire:()=>void) {
  let timer:ReturnType<typeof setTimeout>;
  let stopped=false;
  const events=['pointerdown','pointermove','keydown','wheel','touchstart','scroll'] as const;
  if(lastActivity(userId)===undefined)recordActivity(userId);

  function stop() {
    stopped=true;
    clearTimeout(timer);
    for(const event of events)window.removeEventListener(event,activity,true);
    window.removeEventListener('storage',storage);
    window.removeEventListener('focus',check);
    window.removeEventListener('pageshow',check);
    document.removeEventListener('visibilitychange',check);
  }
  function check() {
    if(stopped)return;
    clearTimeout(timer);
    if(isSessionIdle(userId)){stop();onExpire();return;}
    timer=setTimeout(check,Math.max(1,(lastActivity(userId)??Date.now())+IDLE_TIMEOUT_MS-Date.now()));
  }
  function activity() {
    if(stopped||document.visibilityState!=='visible')return;
    // Check first so a click after sleep cannot revive an expired session.
    if(isSessionIdle(userId)){check();return;}
    if(Date.now()-(lastActivity(userId)??0)<1000)return;
    recordActivity(userId);
    check();
  }
  function storage(event:StorageEvent) {if(event.key===key(userId))check();}

  for(const event of events)window.addEventListener(event,activity,{capture:true,passive:true});
  window.addEventListener('storage',storage);
  window.addEventListener('focus',check);
  window.addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',check);
  check();
  return stop;
}
