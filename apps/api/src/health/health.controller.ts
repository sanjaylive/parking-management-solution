import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/context';
import { PrismaService } from '../common/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'ok', dbLatencyMs: Date.now() - started, uptimeSeconds: Math.round(process.uptime()), version: process.env.npm_package_version ?? '0.1.0' };
  }
}
