import { Controller, Get } from '@nestjs/common';
import { Public } from '#/user/auth/guards';

@Controller('health')
export class HealthController {
  // kubelet sends no Authorization header on liveness and readiness.
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}
