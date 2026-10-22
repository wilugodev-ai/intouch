import {notFound} from 'next/navigation';
import Crm from '../../../ui/crm';
export const metadata={title:'Customer | Touchlumo',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{workspace:string;contact:string}>}){
  const {workspace,contact}=await params;
  if(![workspace,contact].every(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))notFound();
  return <Crm key={workspace+contact} customerRoute={{workspace:workspace.toLowerCase(),contact:contact.toLowerCase()}}/>;
}
