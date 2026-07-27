import { Controller, Get } from '@nestjs/common';
import { Public } from '#/user/auth/guards';

// k8s liveness/readiness probes hit this with no credentials.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
