export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONTACT_ATTACHMENTS = 100;
export const attachmentTypes: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export function validId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function attachmentName(input: string) {
  let name = input;
  // Multipart filenames arrive as UTF-8 bytes decoded as Latin-1 by busboy.
  if (/[^\x00-\x7f]/.test(name) && [...name].every(character => character.charCodeAt(0) <= 255)) {
    try { name = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.from(name, 'latin1')); } catch { /* Already a Unicode filename. */ }
  }
  name = name.normalize('NFC').trim();
  if (!name || name.length > 180 || /[\x00-\x1f\x7f/\\<>:"|?*]/.test(name) || name === '.' || name === '..') throw new Error('Choose a filename of up to 180 characters without path or control characters.');
  return name;
}
export function validateAttachment(file: {originalname: string; mimetype: string; buffer: Buffer; size: number}) {
  const name = attachmentName(file.originalname), extension = name.split('.').pop()?.toLowerCase() || '', type = attachmentTypes[extension];
  if (!type) throw new Error('Supported files: PDF, JPG, PNG, WebP, TXT, CSV, DOCX, XLSX, and PPTX.');
  if (!file.size || file.size !== file.buffer.length || file.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose a nonempty file no larger than 10 MB.');
  const generic = ['application/octet-stream', 'application/zip', 'application/x-zip-compressed'];
  if (file.mimetype !== type && !generic.includes(file.mimetype) && !(extension === 'csv' && ['text/plain', 'application/vnd.ms-excel'].includes(file.mimetype))) throw new Error('The file type does not match its filename.');
  const starts = (bytes: number[]) => bytes.every((byte, index) => file.buffer[index] === byte);
  let valid = false;
  if (extension === 'pdf') valid = file.buffer.subarray(0, 5).toString() === '%PDF-';
  if (extension === 'jpg' || extension === 'jpeg') valid = starts([0xff, 0xd8, 0xff]);
  if (extension === 'png') valid = starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (extension === 'webp') valid = file.buffer.subarray(0, 4).toString() === 'RIFF' && file.buffer.subarray(8, 12).toString() === 'WEBP';
  if (['docx', 'xlsx', 'pptx'].includes(extension)) valid = starts([80, 75, 3, 4]);
  if (extension === 'txt' || extension === 'csv') {
    try { new TextDecoder('utf-8', {fatal: true}).decode(file.buffer); valid = !file.buffer.includes(0); } catch { valid = false; }
  }
  if (!valid) throw new Error('The file contents do not match the selected file type.');
  return {name, type, size: file.size};
}
export function attachmentDisposition(name: string) {
  const safe = attachmentName(name);
  const fallback = safe.replace(/[^a-zA-Z0-9._ -]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
