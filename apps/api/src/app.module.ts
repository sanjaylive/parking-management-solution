import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { env } from './config/env';
import { AdminController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './common/audit.service';
import { AllExceptionsFilter } from './common/errors';
import { IdempotencyModule } from './common/idempotency.service';
import { PrismaModule } from './common/prisma.service';
import { FacilitiesController } from './facilities/facilities.controller';
import { BarrierService } from './hardware/barrier.service';
import { DevicesController } from './hardware/devices.controller';
import { InProcessTransport } from './hardware/transport';
import { HealthController } from './health/health.controller';
import { OccupancyService } from './occupancy/occupancy.service';
import { LedgerService } from './payments/ledger.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PricingService } from './pricing/pricing.service';
import { RatesController } from './pricing/rates.controller';
import { RealtimeModule } from './realtime/live.service';
import { NotificationsModule } from './notifications/notifications.service';
import { SettingsModule } from './settings/settings.service';
import { MeController, PublicController } from './reservations/customer.controller';
import { ReservationsService } from './reservations/reservations.service';
import { GateController, SessionsController } from './sessions/gate.controller';
import { GateService } from './sessions/gate.service';
import { OfflineSyncController, OfflineSyncService } from './sessions/offline-sync';
import { OverridesController } from './staff/overrides.controller';
import { ShiftsController } from './staff/shifts.controller';
import { EntitlementModule } from './tenancy/entitlement.service';
import { OperatorController } from './tenancy/operator.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env().NODE_ENV === 'test' ? 'silent' : 'info',
        transport: env().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        redact: ['req.headers.authorization', 'req.headers["x-signature"]', 'req.headers.cookie'],
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: env().NODE_ENV === 'test' ? 100_000 : 300 }]),
    PrismaModule,
    AuditModule,
    IdempotencyModule,
    EntitlementModule,
    RealtimeModule,
    SettingsModule,
    NotificationsModule,
    AuthModule,
  ],
  controllers: [
    HealthController, FacilitiesController, RatesController, GateController, SessionsController, PaymentsController,
    ShiftsController, OverridesController, MeController, PublicController, DevicesController, AdminController, OperatorController, OfflineSyncController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    OccupancyService, PricingService, LedgerService, PaymentsService, InProcessTransport, BarrierService, GateService, ReservationsService, OfflineSyncService,
  ],
})
export class AppModule {}
