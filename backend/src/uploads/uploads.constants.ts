import { join } from 'path';

/** On disk next to the compiled app, so `dist` rebuilds do not wipe stored images. */
export const UPLOAD_ROOT = join(process.cwd(), 'uploads');
export const CHAT_UPLOAD_DIR = join(UPLOAD_ROOT, 'chat');

/** Clients downscale before upload; this is the backstop for anything that slips through. */
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
