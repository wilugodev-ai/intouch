import PublicRegistration from '../../ui/public-registration';
export const metadata={title:'Customer registration | InTouch',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function Page({params}:{params:Promise<{token:string}>}){const {token}=await params;return <PublicRegistration token={token}/>;}
