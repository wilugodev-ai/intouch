import {BadRequestException, CanActivate, Controller, Delete, ExecutionContext, Get, Header, HttpException, Injectable, NestInterceptor, CallHandler, Param, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {defer, finalize} from 'rxjs';
import {Database} from './database';
import {AttachmentStore} from './attachment-store';
import {validId, validateAttachment, attachmentDisposition, MAX_ATTACHMENT_BYTES, MAX_CONTACT_ATTACHMENTS} from './attachment-rules';

type FileBody = {originalname: string; mimetype: string; buffer: Buffer; size: number};
type Request = {params: {workspace: string; contact: string}; headers: {authorization?: string}; method: string; attachmentUser?: string};
@Injectable()
export class AttachmentAccess implements CanActivate {
  constructor(private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>(), {workspace, contact} = request.params;
    if (![workspace, contact].every(validId)) throw new BadRequestException('Invalid customer reference');
    const {client, user} = await this.db.authenticated(request.headers.authorization);
    const [membership, customer] = await Promise.all([
      client.from('workspace_members').select('role').eq('workspace_id', workspace).eq('user_id', user.id).maybeSingle(),
      client.from('contacts').select('id').eq('workspace_id', workspace).eq('id', contact).maybeSingle(),
    ]);
    this.db.check(membership.error); this.db.check(customer.error);
    if (!membership.data || !customer.data) throw new HttpException('Customer not found', 404);
    if (!['GET', 'HEAD'].includes(request.method) && !['owner', 'member'].includes(membership.data.role)) throw new HttpException('Your workspace role does not allow changing customer files.', 403);
    request.attachmentUser = user.id;
    return true;
  }
}
@Injectable()
export class AttachmentUploadLimit implements NestInterceptor {
  private active = 0;
  private readonly contacts = new Set<string>();
  intercept(context: ExecutionContext, next: CallHandler) {
    const params=context.switchToHttp().getRequest<Request>().params;
    const key=`${params.workspace.toLowerCase()}/${params.contact.toLowerCase()}`;
    if (this.active >= 2 || this.contacts.has(key)) throw new HttpException('Other files are uploading. Please try again in a moment.', 429);
    this.active++; this.contacts.add(key);
    return defer(() => next.handle()).pipe(finalize(() => {this.active--; this.contacts.delete(key);}));
  }
}
@Controller('v1/crm/:workspace/contacts/:contact/files')
@UseGuards(AttachmentAccess)
export class AttachmentsController {
  constructor(private readonly store: AttachmentStore, private readonly db: Database) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(@Param('workspace') workspace: string, @Param('contact') contact: string, @Query('page') value = '0') {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) > 100000) throw new BadRequestException('Invalid page');
    const page = Number(value), rows = await this.store.list(workspace, contact);
    return {rows: rows.slice(page * 20, page * 20 + 20), total: rows.length, page, pageSize: 20, maxBytes: MAX_ATTACHMENT_BYTES, maxFiles: MAX_CONTACT_ATTACHMENTS};
  }
  @Post()
  @UseInterceptors(AttachmentUploadLimit, FileInterceptor('file', {limits: {fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0}}))
  async upload(@Param('workspace') workspace: string, @Param('contact') contact: string, @Req() request: Request, @UploadedFile() file?: FileBody) {
    if (!file) throw new BadRequestException('Choose one file to upload.');
    let metadata: ReturnType<typeof validateAttachment>;
    try { metadata = validateAttachment(file); } catch (error) { throw new BadRequestException((error as Error).message); }
    if ((await this.store.list(workspace, contact)).length >= MAX_CONTACT_ATTACHMENTS) throw new HttpException('This customer already has 100 files. Remove an existing file first.', 409);
    const attachment = await this.store.upload(workspace, contact, {...metadata, uploadedBy: request.attachmentUser!}, file.buffer);
    // Do not retain an upload if the customer disappeared while bytes were received.
    try {
      const client = await this.db.client(request.headers.authorization);
      const [customer, membership] = await Promise.all([client.from('contacts').select('id').eq('workspace_id', workspace).eq('id', contact).maybeSingle(), client.from('workspace_members').select('role').eq('workspace_id', workspace).eq('user_id', request.attachmentUser!).maybeSingle()]);
      this.db.check(customer.error); this.db.check(membership.error);
      if (!customer.data || !membership.data) throw new HttpException('Customer no longer exists or access was removed.', 404);
      if (!['owner', 'member'].includes(membership.data.role)) throw new HttpException('Your workspace role no longer allows uploading files.', 403);
    } catch (error) { await this.store.remove(workspace, contact, attachment.id); throw error; }
    return attachment;
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('workspace') workspace: string, @Param('contact') contact: string, @Param('id') id: string) {
    if (!validId(id)) throw new BadRequestException('Invalid file reference');
    const {attachment, stream} = await this.store.download(workspace, contact, id);
    return new StreamableFile(stream, {type: 'application/octet-stream', length: attachment.size, disposition: attachmentDisposition(attachment.name)});
  }
  @Delete(':id') async remove(@Param('workspace') workspace: string, @Param('contact') contact: string, @Param('id') id: string) {
    if (!validId(id)) throw new BadRequestException('Invalid file reference');
    await this.store.remove(workspace, contact, id); return {deleted: true};
  }
}
