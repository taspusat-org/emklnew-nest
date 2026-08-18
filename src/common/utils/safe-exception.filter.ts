import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { GENERIC_ERROR_MESSAGE, toSafeErrorMessage } from './error-message';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        errors: exception.errors,
        message: exception.message,
        statusCode: HttpStatus.BAD_REQUEST,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        response
          .status(status)
          .json({ statusCode: status, message: this.safe(body, exception) });
        return;
      }

      const payload = { ...(body as Record<string, unknown>) };
      // Array = daftar issue zod; dipetakan per field oleh frontend, jangan disentuh.
      if (typeof payload.message === 'string') {
        payload.message = this.safe(payload.message, exception);
      }
      response.status(status).json(payload);
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: GENERIC_ERROR_MESSAGE,
    });
  }

  private safe(message: string, exception: HttpException): string {
    const sanitized = toSafeErrorMessage(message);
    if (sanitized !== message) {
      this.logger.error(`Pesan teknis disamarkan: ${message}`, exception.stack);
    }
    return sanitized;
  }
}
