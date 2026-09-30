import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MAX_CHAT_IMAGE_BYTES, ALLOWED_IMAGE_MIME } from './uploads.constants';
import { ChatImageStorageService } from './chat-image-storage.service';

/** Minimal shape of a multer file — avoids depending on @types/multer. */
interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Chat attachment uploads.
 *
 * The file is held in memory only long enough to hand it to Supabase Storage —
 * nothing is written to the container's filesystem, so an instance can be
 * replaced at any moment without losing an attachment. The returned URL carries
 * a random object name and is the capability to view the image.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly storage: ChatImageStorageService) {}

  @Post('chat-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_CHAT_IMAGE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
          callback(new BadRequestException(`Unsupported image type: ${file.mimetype}`), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadChatImage(@UploadedFile() file: UploadedImage) {
    if (!file) {
      throw new BadRequestException('No image received');
    }

    const stored = await this.storage.store(file);

    return {
      url: stored.url,
      type: file.mimetype,
      name: file.originalname,
      size: file.size,
      storage: stored.storage,
    };
  }
}
