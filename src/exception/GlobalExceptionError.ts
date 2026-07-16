import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import * as winston from 'winston';

@Catch()
export class GlobalExceptionError implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionError.name);
  private readonly winstonLogger: winston.Logger;

  constructor() {
    this.winstonLogger = winston.createLogger({
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json({
          replacer: (key, value: any) => {
            // Ensure consistent order: timestamp, statusCode, message, stack
            if (key === '') {
              return {
                timestamp: value.timestamp,
                statusCode: value.statusCode,
                message: value.message,
                stack: value.stack || 'No stack trace',
              };
            }
            return value;
          },
          space: 4, // Pretty-print JSON with 4-space indentation
        }),
      ),
      transports: [
        new winston.transports.File({
          filename: 'error.log',
          maxsize: 5242880, // 5MB
          maxFiles: 5, // Keep up to 5 rotated files
        }),
      ],
    });
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    let message: string;
    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      // Ensure message is a string
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : typeof exceptionResponse === 'object' &&
              exceptionResponse['message']
            ? exceptionResponse['message']
            : JSON.stringify(exceptionResponse);
    } else {
      message = 'Internal server error';
    }

    const errorLog = {
      timestamp: new Date().toISOString(),
      statusCode: status,
      message,
      stack: exception instanceof Error ? exception.stack : '',
    };

    // Log to console using NestJS logger
    this.logger.error(
      `Exception caught: ${JSON.stringify(errorLog, null, 4)}`,
      exception instanceof Error ? exception.stack : '',
    );

    // Log to file using Winston
    this.winstonLogger.error(errorLog);

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: errorLog.timestamp,
    });
  }
}
