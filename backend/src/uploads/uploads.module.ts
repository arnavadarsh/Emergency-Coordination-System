import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { ChatImageStorageService } from './chat-image-storage.service';

/**
 * Uploads Module
 * Chat attachments, stored in the project's Supabase Storage bucket.
 * The upload directory is no longer created at boot: a deployed instance is not
 * meant to hold files, and the dev fallback creates it lazily if it is used.
 */
@Module({
  controllers: [UploadsController],
  providers: [ChatImageStorageService],
  exports: [ChatImageStorageService],
})
export class UploadsModule {}
