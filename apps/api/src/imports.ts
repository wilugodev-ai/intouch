import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
export function parseContacts(csv:unknown) {
  if(typeof csv!=='string'||Buffer.byteLength(csv)>512000||!csv.trim())throw new BadRequestException('Choose a UTF-8 CSV file under 500 KB.');
  let records:string[][];
  try{records=parse(csv,{bom:true,skip_empty_lines:true,trim:true,max_record_size:12000});}catch{throw new BadRequestException('Invalid CSV. Check quotes and the number of columns on each row.');}
  if(records.length<2||records.length>501)throw new BadRequestException('The CSV must contain 1–500 contacts.');
  const headers=records.shift()!.map(h=>h.toLowerCase().trim());
  const allowed=['name','email','phone','company','status','tags'];
  if(!headers.includes('name')||headers.some(h=>!allowed.includes(h))||new Set(headers).size!==headers.length)throw new BadRequestException('Use unique headers: name (required), email, phone, company, status, tags.');
  const rows:Record<string,unknown>[]=[];
  const errors:{row:number;message:string}[]=[];
  const seen=new Set<string>();let duplicates=0;
  records.forEach((values,index)=>{
    const row=Object.fromEntries(headers.map((h,i)=>[h,values[i]||'']));
    const tags=[...new Set((row.tags||'').split('|').map(t=>t.trim()).filter(Boolean))];
    row.status=row.status||'Lead';row.email=(row.email||'').toLowerCase();
    if(!row.name?.trim()||Object.values(row).some(v=>v.length>300)||tags.length>20||tags.some(t=>t.length>40)||!['Lead','Customer','Inactive'].includes(row.status)||(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))){errors.push({row:index+2,message:'Check name, email, status, and field lengths.'});return;}
    if(row.email&&seen.has(row.email)){duplicates++;return;}
    if(row.email)seen.add(row.email);
    rows.push({name:row.name,email:row.email,phone:row.phone||'',company:row.company||'',status:row.status,tags});
  });
  return {rows,errors,duplicates,total:records.length};
}
