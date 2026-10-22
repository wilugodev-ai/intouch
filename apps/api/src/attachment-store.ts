import {Injectable, HttpException, ServiceUnavailableException} from '@nestjs/common';
import {Storage} from '@google-cloud/storage';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile, readdir, rename, rm, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve, sep, join} from 'node:path';
import {validId, MAX_ATTACHMENT_BYTES} from './attachment-rules';
export type Attachment = {id: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy: string};
@Injectable()
export class AttachmentStore {
  private readonly bucketName = process.env.ATTACHMENTS_BUCKET || '';
  private readonly cloud = this.bucketName ? new Storage() : null;
  private readonly localRoot = resolve(process.env.ATTACHMENTS_LOCAL_DIR || resolve(process.cwd(), '../../.data/attachments'));
  get configured() { return Boolean(this.bucketName || process.env.NODE_ENV !== 'production'); }
  private check() { if (!this.configured) throw new ServiceUnavailableException('Customer files are not available yet.'); }
  private key(workspace: string, contact: string, id?: string) {
    if (![workspace, contact, ...(id ? [id] : [])].every(validId)) throw new HttpException('Invalid file reference', 400);
    return `customers/${workspace.toLowerCase()}/${contact.toLowerCase()}/${id?.toLowerCase() || ''}`;
  }
  private local(key: string) {
    const target = resolve(this.localRoot, key);
    if (!target.startsWith(this.localRoot + sep)) throw new HttpException('Invalid file reference', 400);
    return target;
  }
  private failure(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const code = (error as {code?: string|number})?.code;
    if (code === 404 || code === 'ENOENT') throw new HttpException('File not found', 404);
    throw new ServiceUnavailableException('Files are temporarily unavailable. Please try again.');
  }
  async list(workspace: string, contact: string): Promise<Attachment[]> {
    this.check(); const prefix = this.key(workspace, contact);
    try {
      let rows: Attachment[];
      if (this.cloud) {
        const [files] = await this.cloud.bucket(this.bucketName).getFiles({prefix});
        rows = files.filter(file => validId(file.name.slice(prefix.length))).map(file => {
          const metadata = file.metadata.metadata || {};
          return {id: file.name.slice(prefix.length), name: Buffer.from(String(metadata.filename || ''), 'base64').toString('utf8'), type: String(metadata.filetype || 'application/octet-stream'), size: Number(file.metadata.size), uploadedAt: String(file.metadata.timeCreated), uploadedBy: String(metadata.uploadedBy || '')};
        });
      } else {
        const directory = this.local(prefix);
        let entries: string[];
        try { entries = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
        rows = await Promise.all(entries.filter(validId).map(async id => JSON.parse(await readFile(join(directory, id, 'metadata.json'), 'utf8')) as Attachment));
      }
      return rows.sort((first, second) => second.uploadedAt.localeCompare(first.uploadedAt) || first.id.localeCompare(second.id));
    } catch (error) { return this.failure(error); }
  }
  async upload(workspace: string, contact: string, metadata: Omit<Attachment, 'id'|'uploadedAt'>, buffer: Buffer) {
    this.check(); const attachment: Attachment = {...metadata, id: randomUUID(), uploadedAt: new Date().toISOString()};
    const key = this.key(workspace, contact, attachment.id);
    try {
      if (this.cloud) {
        await this.cloud.bucket(this.bucketName).file(key).save(buffer, {resumable: false, preconditionOpts: {ifGenerationMatch: 0}, metadata: {contentType: 'application/octet-stream', cacheControl: 'private, no-store', metadata: {filename: Buffer.from(attachment.name).toString('base64'), filetype: attachment.type, uploadedBy: attachment.uploadedBy}}});
      } else {
        const target = this.local(key), temporary = target + '.pending';
        await mkdir(temporary, {recursive: true});
        try { await writeFile(join(temporary, 'file'), buffer); await writeFile(join(temporary, 'metadata.json'), JSON.stringify(attachment)); await rename(temporary, target); }
        finally { await rm(temporary, {recursive: true, force: true}); }
      }
      return attachment;
    } catch (error) { return this.failure(error); }
  }
  async download(workspace: string, contact: string, id: string) {
    this.check(); const key = this.key(workspace, contact, id);
    try {
      const attachment = (await this.list(workspace, contact)).find(file => file.id === id.toLowerCase());
      if (!attachment) throw new HttpException('File not found', 404);
      if (attachment.size < 1 || attachment.size > MAX_ATTACHMENT_BYTES) throw new HttpException('This file cannot be downloaded.', 400);
      if (this.cloud) return {attachment, stream: this.cloud.bucket(this.bucketName).file(key).createReadStream()};
      const path = join(this.local(key), 'file');
      const info = await stat(path); if (info.size !== attachment.size) throw new ServiceUnavailableException('This file is temporarily unavailable.');
      return {attachment, stream: createReadStream(path)};
    } catch (error) { return this.failure(error); }
  }
  async remove(workspace: string, contact: string, id: string) {
    this.check(); const key = this.key(workspace, contact, id);
    try {
      if (this.cloud) await this.cloud.bucket(this.bucketName).file(key).delete();
      else await rm(this.local(key), {recursive: true});
    } catch (error) { this.failure(error); }
  }
}
