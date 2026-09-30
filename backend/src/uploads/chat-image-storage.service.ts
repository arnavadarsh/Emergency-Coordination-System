import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_UPLOAD_DIR } from './uploads.constants';

export interface StoredImage {
  /** Address the dashboards put in an <img src>. */
  url: string;
  /** Where it went: the Supabase project, or dev-only local disk. */
  storage: 'supabase' | 'local';
}

/**
 * Chat attachment storage.
 *
 * Uploaded images go to the project's Supabase Storage bucket — the same place
 * as every other piece of saved state — so a deployed instance keeps nothing of
 * its own. Container filesystems are ephemeral: an image written to local disk
 * is gone at the next restart, deploy or scale event, and invisible to any
 * second instance in the meantime.
 *
 * Local disk remains only as a development fallback, used when no Supabase
 * credentials are configured. Production refuses to start in that state — see
 * config/startup-checks.ts.
 *
 * Privacy model is unchanged: the object name is a random UUID and the URL is
 * the capability. Anyone holding the link can fetch the image, and nobody can
 * guess one.
 */
@Injectable()
export class ChatImageStorageService {
  private readonly logger = new Logger(ChatImageStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  get usesSupabase(): boolean {
    return Boolean(this.supabaseUrl && this.serviceRoleKey);
  }

  private get supabaseUrl(): string {
    return this.configService.get<string>('supabase.url', '');
  }

  private get serviceRoleKey(): string {
    return this.configService.get<string>('supabase.serviceRoleKey', '');
  }

  async store(file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<StoredImage> {
    const extension = (extname(file.originalname) || '.jpg').toLowerCase().slice(0, 10);
    const objectName = `${randomUUID()}${extension}`;

    if (this.usesSupabase) {
      return this.storeInSupabase(objectName, file.mimetype, file.buffer);
    }

    // Local disk is a development convenience. In a deployment the filesystem
    // is ephemeral, so writing there would accept the image and lose it — worse
    // than refusing it, because the sender believes it arrived.
    if (this.configService.get<string>('app.nodeEnv') === 'production') {
      this.logger.error('Attachment rejected: Supabase Storage is not configured.');
      throw new ServiceUnavailableException(
        'Image attachments are unavailable right now. You can still send a text message.',
      );
    }

    this.logger.warn(
      'Supabase Storage is not configured — writing this attachment to local disk. ' +
        'That is development-only: the file will not survive a restart.',
    );
    return this.storeOnDisk(objectName, file.buffer);
  }

  /**
   * Upload through Supabase's Storage REST API.
   *
   * Done with a plain request rather than the supabase-js client: this is one
   * POST, and the service role key must stay on the server either way.
   */
  private async storeInSupabase(objectName: string, contentType: string, buffer: Buffer): Promise<StoredImage> {
    const bucket = this.configService.get<string>('supabase.storage.bucket', 'chat-attachments');
    const prefix = this.configService.get<string>('supabase.storage.prefix', 'chat');
    const timeoutMs = this.configService.get<number>('supabase.storage.uploadTimeoutMs', 15000);
    const objectPath = `${prefix}/${objectName}`.replace(/^\/+/, '');

    let response: Response;
    try {
      response = await fetch(`${this.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        body: new Uint8Array(buffer),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: any) {
      this.logger.error(`Supabase Storage upload failed: ${error?.message ?? error}`);
      throw new InternalServerErrorException('Could not store the image. Please try again.');
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Supabase Storage rejected the upload (HTTP ${response.status}): ${detail.slice(0, 300)}`);
      throw new InternalServerErrorException('Could not store the image. Please try again.');
    }

    return {
      url: `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`,
      storage: 'supabase',
    };
  }

  private async storeOnDisk(objectName: string, buffer: Buffer): Promise<StoredImage> {
    await mkdir(CHAT_UPLOAD_DIR, { recursive: true });
    await writeFile(join(CHAT_UPLOAD_DIR, objectName), buffer);
    return { url: `/uploads/chat/${objectName}`, storage: 'local' };
  }
}
