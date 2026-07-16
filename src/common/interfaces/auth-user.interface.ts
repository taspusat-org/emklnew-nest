import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: { email: string }; // Sesuaikan dengan payload dari token JWT
}
