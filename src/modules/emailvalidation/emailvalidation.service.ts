import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

export interface EmailValidationResult {
  email: string;
  isValid: boolean;
  isSyntaxValid: boolean;
  hasMxRecords: boolean;
  isDisposable: boolean;
  isFreeProvider: boolean;
  isRoleEmail: boolean;
  didYouMean?: string;
  score: number;
  details: string[];
  provider?: string;
}

@Injectable()
export class EmailvalidationService {
  constructor(private readonly httpService: HttpService) {}

  /**
   * Validasi syntax email menggunakan regex
   */
  private validateSyntax(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const complexRegex =
      /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;

    return emailRegex.test(email) && complexRegex.test(email);
  }

  /**
   * Check MX records untuk verifikasi domain
   */
  private async checkMxRecords(
    domain: string,
  ): Promise<{ hasRecords: boolean; provider?: string }> {
    try {
      const addresses = await resolveMx(domain);

      if (addresses && addresses.length > 0) {
        const mxRecord = addresses[0].exchange.toLowerCase();

        // Detect provider
        let provider: string | undefined;
        if (mxRecord.includes('google')) provider = 'Google/Gmail';
        else if (mxRecord.includes('outlook') || mxRecord.includes('microsoft'))
          provider = 'Microsoft/Outlook';
        else if (mxRecord.includes('yahoo')) provider = 'Yahoo';
        else if (mxRecord.includes('zoho')) provider = 'Zoho';

        return { hasRecords: true, provider };
      }

      return { hasRecords: false };
    } catch (error) {
      return { hasRecords: false };
    }
  }

  /**
   * Check apakah email dari free provider
   */
  private isFreeEmailProvider(domain: string): boolean {
    const freeProviders = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'aol.com',
      'mail.com',
      'protonmail.com',
      'icloud.com',
      'zoho.com',
      'yandex.com',
      'gmx.com',
      'yahoo.co.id',
      'rocketmail.com',
      'live.com',
      'msn.com',
    ];

    return freeProviders.includes(domain.toLowerCase());
  }

  /**
   * Check apakah disposable/temporary email
   */
  private isDisposableEmail(domain: string): boolean {
    const disposableDomains = [
      'tempmail.com',
      'guerrillamail.com',
      '10minutemail.com',
      'throwaway.email',
      'maildrop.cc',
      'mailinator.com',
      'temp-mail.org',
      'yopmail.com',
      'trashmail.com',
      'getnada.com',
      'fakeinbox.com',
      'mohmal.com',
    ];

    return disposableDomains.includes(domain.toLowerCase());
  }

  /**
   * Check apakah role-based email
   */
  private isRoleBasedEmail(email: string): boolean {
    const rolePrefixes = [
      'admin',
      'support',
      'info',
      'sales',
      'contact',
      'help',
      'noreply',
      'no-reply',
      'webmaster',
      'postmaster',
      'marketing',
      'billing',
      'team',
      'office',
    ];

    const localPart = email.split('@')[0].toLowerCase();
    return rolePrefixes.some((prefix) => localPart.includes(prefix));
  }

  /**
   * Suggest typo correction
   */
  private suggestCorrection(email: string): string | undefined {
    const commonDomains = {
      'gmial.com': 'gmail.com',
      'gmai.com': 'gmail.com',
      'gnail.com': 'gmail.com',
      'yahooo.com': 'yahoo.com',
      'yaho.com': 'yahoo.com',
      'hotmial.com': 'hotmail.com',
      'outlok.com': 'outlook.com',
    };

    const [localPart, domain] = email.split('@');

    if (commonDomains[domain?.toLowerCase()]) {
      return `${localPart}@${commonDomains[domain.toLowerCase()]}`;
    }

    return undefined;
  }

  /**
   * Validasi menggunakan external API (gratis)
   */
  private async validateWithExternalAPI(email: string): Promise<any> {
    try {
      // Menggunakan Abstract API (free tier: 100 requests/month)
      // Atau bisa gunakan rapid-email-verifier.fly.dev yang fully free
      const response = await firstValueFrom(
        this.httpService.get(
          `https://rapid-email-verifier.fly.dev/api/validate?email=${encodeURIComponent(email)}`,
        ),
      );
      console.log('response', response);
      return response.data;
    } catch (error) {
      console.log('error', error);
      console.error('External API validation failed:', error.message);
      return null;
    }
  }

  /**
   * Main validation function
   */
  async validateEmail(email: string): Promise<EmailValidationResult> {
    email = email.trim().toLowerCase();
    const details: string[] = [];
    let score = 0;

    // 1. Syntax validation
    const isSyntaxValid = this.validateSyntax(email);
    if (!isSyntaxValid) {
      return {
        email,
        isValid: false,
        isSyntaxValid: false,
        hasMxRecords: false,
        isDisposable: false,
        isFreeProvider: false,
        isRoleEmail: false,
        score: 0,
        details: ['Invalid email syntax'],
      };
    }
    score += 20;
    details.push('Valid syntax');

    const [localPart, domain] = email.split('@');

    // 2. Check typo
    const didYouMean = this.suggestCorrection(email);
    if (didYouMean) {
      details.push(`Did you mean: ${didYouMean}?`);
      score -= 10;
    }

    // 3. Check disposable
    const isDisposable = this.isDisposableEmail(domain);
    if (isDisposable) {
      details.push('Disposable/temporary email detected');
      score -= 30;
    } else {
      score += 20;
    }

    // 4. Check free provider
    const isFreeProvider = this.isFreeEmailProvider(domain);
    if (isFreeProvider) {
      details.push('Free email provider');
      score += 10;
    } else {
      details.push('Corporate/custom domain');
      score += 15;
    }

    // 5. Check role-based
    const isRoleEmail = this.isRoleBasedEmail(email);
    if (isRoleEmail) {
      details.push('Role-based email (not personal)');
      score -= 5;
    } else {
      score += 10;
    }

    // 6. Check MX records
    const mxResult = await this.checkMxRecords(domain);
    const hasMxRecords = mxResult.hasRecords;

    if (hasMxRecords) {
      details.push('Domain has valid MX records');
      score += 30;
      if (mxResult.provider) {
        details.push(`Provider: ${mxResult.provider}`);
      }
    } else {
      details.push('No MX records found - domain cannot receive emails');
      score -= 40;
    }

    // 7. Try external API validation (optional, best effort)
    try {
      const externalResult = await this.validateWithExternalAPI(email);
      if (externalResult) {
        details.push('Verified with external API');
        score += 5;
      }
    } catch (error) {
      // Ignore external API errors
    }

    // Normalize score to 0-100
    score = Math.max(0, Math.min(100, score));

    const isValid = score >= 60 && hasMxRecords && !isDisposable;

    return {
      email,
      isValid,
      isSyntaxValid,
      hasMxRecords,
      isDisposable,
      isFreeProvider,
      isRoleEmail,
      didYouMean,
      score,
      details,
      provider: mxResult.provider,
    };
  }

  /**
   * Validate multiple emails (semicolon separated)
   */
  async validateMultipleEmails(
    emailString: string,
  ): Promise<EmailValidationResult[]> {
    const emails = emailString
      .split(';')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    const results: EmailValidationResult[] = [];

    for (const email of emails) {
      try {
        const result = await this.validateEmail(email);
        results.push(result);
      } catch (error) {
        results.push({
          email,
          isValid: false,
          isSyntaxValid: false,
          hasMxRecords: false,
          isDisposable: false,
          isFreeProvider: false,
          isRoleEmail: false,
          score: 0,
          details: [`Error: ${error.message}`],
        });
      }
    }

    return results;
  }
}
