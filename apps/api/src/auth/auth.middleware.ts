import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from '../common/request.js';
import { SESSION_COOKIES, SessionService, sessionFitsKind, sessionKindFor } from './session.service.js';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: AppRequest, res: Response, next: NextFunction) {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    try {
      const kind = sessionKindFor(req);
      const auth = await this.sessions.resolve(req.cookies?.[SESSION_COOKIES[kind]]);
      // 쿠키 종류와 세션 종류가 다르면(예전 방식으로 심긴 쿠키) 로그인하지 않은 것으로 본다
      req.auth = auth && sessionFitsKind(auth.actorKind, kind) ? auth : undefined;
      next();
    } catch (err) {
      next(err);
    }
  }
}
