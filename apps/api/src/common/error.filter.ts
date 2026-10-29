import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

// DB 트리거가 던지는 업무 규칙 오류 메시지(대문자 코드)를 사용자용 문구로 바꾼다
const DB_RULE_MESSAGES: Record<string, [number, string]> = {
  TENANT_NOT_ACCEPTING_ORDERS: [409, '지금은 주문을 받지 않는 매장입니다'],
  INVALID_ORDER_TRANSITION: [409, '현재 주문 상태에서는 할 수 없는 변경입니다'],
  ORDER_NOT_PAID: [409, '결제가 확인되지 않은 주문입니다'],
  REFUND_EXCEEDS_PAYMENT: [409, '환불 금액이 결제 금액을 넘습니다'],
  PAYMENT_NOT_REFUNDABLE: [409, '환불할 수 없는 결제 상태입니다'],
  STORE_NOT_IN_TENANT: [404, '매장을 찾을 수 없습니다'],
};

interface PgError {
  code?: string;
  message: string;
  constraint?: string;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const requestId = (req as Request & { id?: string }).id;
    const send = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId } });

    if (exception instanceof AppError) {
      return send(exception.getStatus(), exception.code, exception.message, exception.details);
    }
    if (exception instanceof ZodError) {
      // 입력값 오류는 위치와 사유만 돌려주고 입력값 자체는 되돌려주지 않는다
      const details = exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return send(422, 'VALIDATION_FAILED', '입력값을 확인해 주세요', details);
    }
    if (exception instanceof ThrottlerException) {
      return send(429, 'RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'HTTP_ERROR';
      return send(status, code, status === 404 ? '요청한 경로를 찾을 수 없습니다' : exception.message);
    }

    const pgErr = exception as PgError;
    if (pgErr && typeof pgErr.code === 'string' && pgErr.code.length === 5) {
      const rule = /^([A-Z_]{4,})/.exec(pgErr.message)?.[1];
      if (rule && DB_RULE_MESSAGES[rule]) {
        const [status, message] = DB_RULE_MESSAGES[rule]!;
        return send(status, rule, message);
      }
      if (pgErr.code === '23505') return send(409, 'DUPLICATE', '이미 존재하는 값입니다');
      if (pgErr.code === '23503') return send(422, 'INVALID_REFERENCE', '연결된 항목을 찾을 수 없습니다');
      if (pgErr.code === '42501') return send(404, 'NOT_FOUND', '요청한 항목을 찾을 수 없습니다');
      if (pgErr.code === '23514') return send(422, 'VALIDATION_FAILED', '입력값이 규칙에 맞지 않습니다');
    }

    // 내부 오류 상세는 로그에만 남기고 응답에는 노출하지 않는다
    this.logger.error(`[${requestId}] ${req.method} ${req.path}: ${(exception as Error)?.stack ?? String(exception)}`);
    return send(500, 'INTERNAL', '일시적인 오류가 발생했습니다');
  }
}
