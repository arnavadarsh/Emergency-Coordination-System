/**
 * Minimal ambient types for the multer APIs this project uses.
 * Avoids pulling in @types/multer for two function signatures.
 */
declare module 'multer' {
  export interface MulterFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  export interface StorageEngine {
    _handleFile(req: any, file: MulterFile, callback: (error?: any, info?: Partial<MulterFile>) => void): void;
    _removeFile(req: any, file: MulterFile, callback: (error: Error | null) => void): void;
  }

  export interface DiskStorageOptions {
    destination?:
      | string
      | ((req: any, file: MulterFile, callback: (error: Error | null, destination: string) => void) => void);
    filename?: (req: any, file: MulterFile, callback: (error: Error | null, filename: string) => void) => void;
  }

  export function diskStorage(options: DiskStorageOptions): StorageEngine;
  export function memoryStorage(): StorageEngine;
}
