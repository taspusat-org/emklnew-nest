import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    console.log(
      `${new Date().toISOString()} AuthGuard ENTER ${request.method} ${request.url}`,
    );
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      return false;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return false;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      request.user = payload;
      console.log(
        `${new Date().toISOString()} AuthGuard EXIT  ${request.method} ${request.url}`,
      );
      return true;
    } catch (error) {
      return false;
    }
  }
}
