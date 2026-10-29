import { HttpException } from '@nestjs/common';

/** 클라이언트에 그대로 보여줄 수 있는 오류. code 는 docs/05-api-spec.md 의 오류 코드 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = '요청한 항목') => new AppError('NOT_FOUND', 404, `${what}을(를) 찾을 수 없습니다`);
export const forbidden = (message = '권한이 없습니다') => new AppError('FORBIDDEN', 403, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(code, 409, message, details);
