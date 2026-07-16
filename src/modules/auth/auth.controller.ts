import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { LoginDto, LoginSchema } from './dto/login.dto';
import { RegisterSchema } from './dto/register.dto';
import { ForgetPasswordSchema } from './dto/forget-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginDto) {
    // Destructure the email and password from the body and pass them to the service method
    return this.authService.login(body);
  }

  @Post('register')
  async register(@Body(new ZodValidationPipe(RegisterSchema)) body: any) {
    return this.authService.register(body);
  }
  @Post('refresh-token')
  refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }
  @Post('send-reset-password')
  sendResetPassword(@Body('username') username: string) {
    return this.authService.sendPasswordResetToken(username);
  }
  @Post('reset-password')
  resetPassword(@Body(new ZodValidationPipe(ForgetPasswordSchema)) body: any) {
    return this.authService.resetPassword(body);
  }
  @Post('check-token')
  async checkToken(
    @Body() body: any,
  ): Promise<{ valid: boolean; message: string }> {
    return this.authService.verifyResetToken(body.token);
  }
  @Put('change-password')
  async changePassword(@Body() body: { id: number; newPassword: string }) {
    const { id, newPassword } = body;

    // Call the service method to change the password
    return this.authService.changePassword(id, newPassword);
  }
}
