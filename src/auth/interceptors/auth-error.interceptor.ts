import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class AuthErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // Handle JWT expiration errors
        if (error.name === 'TokenExpiredError') {
          return throwError(
            () =>
              new UnauthorizedException({
                statusCode: 401,
                message: 'Token has expired',
                error: 'Unauthorized',
              }),
          );
        }

        // Handle invalid JWT errors
        if (error.name === 'JsonWebTokenError') {
          return throwError(
            () =>
              new UnauthorizedException({
                statusCode: 401,
                message: 'Invalid token',
                error: 'Unauthorized',
              }),
          );
        }

        // Pass through other errors
        return throwError(() => error);
      }),
    );
  }
}
