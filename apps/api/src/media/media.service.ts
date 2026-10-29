import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import sharp, { type OutputInfo } from 'sharp';
import { CryptoService } from '../common/crypto.service.js';
import { AppError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface StoredImage {
  storageKey: string;
  mimeType: 'image/webp';
  byteSize: number;
  sha256: Buffer;
  width: number;
  height: number;
}

/**
 * 이미지 업로드 처리.
 *  1) 확장자·Content-Type 이 아니라 파일 앞부분(매직 바이트)으로 형식을 판별
 *  2) sharp 로 디코딩해 실제 이미지인지 확인하고 WebP 로 다시 인코딩 (EXIF·GPS 등 메타데이터 제거, 숨은 페이로드 제거)
 *  3) 추측할 수 없는 무작위 파일명으로 업체별 경로에 저장
 * 저장소는 현재 로컬 디스크만 구현. S3 호환 저장소는 계정 준비 후 같은 인터페이스로 추가한다.
 */
@Injectable()
export class MediaService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async storeImage(tenantId: string, kind: 'menu_image' | 'store_logo', input: Buffer): Promise<StoredImage> {
    if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) throw new AppError('INVALID_FILE', 422, '이미지는 5MB 이하여야 합니다');
    const type = await fileTypeFromBuffer(input);
    if (!type || !ALLOWED.has(type.mime)) throw new AppError('INVALID_FILE', 422, 'JPG, PNG, WebP 이미지만 올릴 수 있습니다');

    let output: { data: Buffer; info: OutputInfo };
    try {
      output = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppError('INVALID_FILE', 422, '이미지 파일을 읽을 수 없습니다');
    }

    const storageKey = `tenants/${tenantId}/${kind}/${CryptoService.randomToken(18)}.webp`;
    const target = path.resolve(this.env.MEDIA_LOCAL_DIR, storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output.data, { flag: 'wx' });
    return {
      storageKey,
      mimeType: 'image/webp',
      byteSize: output.data.length,
      sha256: createHash('sha256').update(output.data).digest(),
      width: output.info.width,
      height: output.info.height,
    };
  }

  publicUrl(storageKey: string | null | undefined): string | null {
    return storageKey ? `${this.env.mediaPublicBaseUrl}/${storageKey}` : null;
  }
}
