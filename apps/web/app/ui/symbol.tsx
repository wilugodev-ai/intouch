export default function Icon({name,size=20}:{name:string;size?:number}) {
  const paths: Record<string,React.ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    inbox:<><path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5"/></>,
    contacts:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
    pipeline:<><rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/></>,
    tasks:<><rect x="4" y="4" width="16" height="17" rx="3"/><path d="M9 3h6v4H9zM8 14l3 3 5-6"/></>,
    channels:<><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(0 -1)"/></>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
    arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>,
    plus:<path d="M12 5v14M5 12h14"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    chat:<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/>,
    logout:<><path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/></>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.chat}</svg>;
}
