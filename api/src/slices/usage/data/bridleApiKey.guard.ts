import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class BridleApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-bridle-api-key'];
    const presented = Array.isArray(header) ? header[0] : header;
    const expected = this.config.get<string>('BRIDLE_API_KEY');
    if (!expected || presented !== expected) {
      throw new UnauthorizedException('Invalid bridle api key');
    }
    return true;
  }
}
