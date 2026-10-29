import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from '../common/request.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: AppRequest, res: Response, next: NextFunction) {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    try {
      req.auth = (await this.sessions.resolve(req.cookies?.[SESSION_COOKIE])) ?? undefined;
      next();
    } catch (err) {
      next(err);
    }
  }
}
