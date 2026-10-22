import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentName, attachmentDisposition, validateAttachment, MAX_ATTACHMENT_BYTES} from '../apps/api/src/attachment-rules.ts';
function file(name,buffer,type='application/octet-stream'){return {originalname:name,buffer,mimetype:type,size:buffer.length};}
test('attachment validation rejects unsafe names, executable types, empty and oversized files, and spoofed contents',()=>{
  for(const name of ['../invoice.pdf','folder\\invoice.pdf','bad\r\nname.pdf','a'.repeat(181)+'.pdf'])assert.throws(()=>attachmentName(name));
  for(const name of ['invoice.html','image.svg','run.exe','macro.docm'])assert.throws(()=>validateAttachment(file(name,Buffer.from('content'))));
  assert.throws(()=>validateAttachment(file('empty.txt',Buffer.alloc(0))));
  assert.throws(()=>validateAttachment(file('large.txt',Buffer.alloc(MAX_ATTACHMENT_BYTES+1,65))));
  assert.throws(()=>validateAttachment(file('fake.pdf',Buffer.from('not a pdf'),'application/pdf')));
  assert.throws(()=>validateAttachment(file('fake.png',Buffer.from('%PDF-1.4'),'image/png')));
  assert.throws(()=>validateAttachment(file('fake.txt',Buffer.from([0,255]))));
  assert.throws(()=>validateAttachment(file('mismatch.pdf',Buffer.from('%PDF-1.4'),'image/jpeg')));
});
test('attachment validation preserves bytes and produces a safe Unicode download name',()=>{
  const buffer=Buffer.from('customer notes\n');assert.deepEqual(validateAttachment(file('notes.txt',buffer,'text/plain')),{name:'notes.txt',type:'text/plain',size:buffer.length});
  assert.equal(validateAttachment(file('invoice.pdf',Buffer.from('%PDF-1.4\n'),'application/pdf')).type,'application/pdf');
  assert.equal(validateAttachment(file('image.png',Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png')).type,'image/png');
  assert.equal(attachmentName('caf\u00c3\u00a9.pdf'),'caf\u00e9.pdf');
  const disposition=attachmentDisposition('caf\u00e9.pdf');assert.match(disposition,/filename\*=UTF-8''caf%C3%A9.pdf/);assert.doesNotMatch(disposition,/[\r\n]/);
});
