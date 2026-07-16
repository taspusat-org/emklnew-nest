import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    console.log(`${new Date().toISOString()} ENTER ${req.method} ${req.url}`);
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(
        `${new Date().toISOString()} FINISH ${req.url} took ${duration}ms`,
      );
    });
    next();
  }
}
