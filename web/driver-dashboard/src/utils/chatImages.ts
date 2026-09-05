/** Shared image handling for case chat attachments. */

export interface ChatAttachment {
  url: string;
  type: string;
  name: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  name: string;
  /** Object URL for the optimistic preview; revoke once the send settles. */
  previewUrl: string;
}

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Hard cap on what we will even try to read, before downscaling. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Longest edge after downscaling — plenty for reading a wound or a house number. */
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;

const readImage = (file: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });

/**
 * Downscale and re-encode before upload. An unmodified phone photo is 3-5 MB, which is a
 * poor trade over mobile data when the ambulance is moving — 1600px is more than enough
 * detail and lands well under a megabyte.
 *
 * GIFs are passed through untouched so animation survives.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, WebP or GIF images can be sent');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That image is too large to send');
  }

  if (file.type === 'image/gif') {
    const img = await readImage(file);
    return {
      blob: file,
      width: img.naturalWidth,
      height: img.naturalHeight,
      name: file.name || 'image.gif',
      previewUrl: URL.createObjectURL(file),
    };
  }

  const img = await readImage(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image');
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('Could not process that image');

  const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
  return {
    blob,
    width,
    height,
    name: `${baseName}.jpg`,
    previewUrl: URL.createObjectURL(blob),
  };
}

/** POST the prepared image and return the attachment record to attach to a message. */
export async function uploadChatImage(
  apiBaseUrl: string,
  token: string | null,
  prepared: PreparedImage,
): Promise<ChatAttachment> {
  const form = new FormData();
  form.append('file', prepared.blob, prepared.name);

  const response = await fetch(`${apiBaseUrl}/uploads/chat-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message || `Upload failed (${response.status})`);
  }

  const saved = await response.json();
  return { ...saved, width: prepared.width, height: prepared.height };
}

/** Attachment URLs come back relative so they survive a host change. */
export const resolveAttachmentUrl = (apiBaseUrl: string, url: string) =>
  url.startsWith('blob:') || url.startsWith('http') ? url : `${apiBaseUrl.replace(/\/api\/?$/, '')}${url}`;
