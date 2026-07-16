import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import {
  EmailvalidationService,
  EmailValidationResult,
} from './emailvalidation.service';

@Controller('email-validation')
export class EmailValidationController {
  constructor(
    private readonly emailValidationService: EmailvalidationService,
  ) {}

  @Post('validate')
  async validateEmail(
    @Body('email') email: string,
  ): Promise<EmailValidationResult | { error: string }> {
    if (!email) {
      return { error: 'Email is required' };
    }

    try {
      return await this.emailValidationService.validateEmail(email);
    } catch (error) {
      return { error: error.message };
    }
  }

  @Post('validate-multiple')
  async validateMultipleEmails(
    @Body('emails') emails: string,
  ): Promise<EmailValidationResult[] | { error: string }> {
    if (!emails) {
      return { error: 'Emails string is required (separated by semicolon)' };
    }

    try {
      return await this.emailValidationService.validateMultipleEmails(emails);
    } catch (error) {
      return { error: error.message };
    }
  }

  @Get('check')
  async quickCheck(@Query('email') email: string) {
    if (!email) {
      return { error: 'Email query parameter is required' };
    }

    try {
      const result = await this.emailValidationService.validateEmail(email);
      return {
        email: result.email,
        isValid: result.isValid,
        score: result.score,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}
