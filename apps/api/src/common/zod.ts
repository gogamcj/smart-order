import type { ZodType } from 'zod';

/** 컨트롤러에서 요청 본문·쿼리를 검증한다. 실패하면 ErrorFilter 가 422 로 바꾼다 */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
