import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/env';
import { PrismaService } from '../common/prisma.service';

/**
 * Realtime fan-out. Rooms are per facility. Events are notifications only — clients refetch
 * authoritative state via REST (polling fallback every 15s in the web/mobile clients).
 */
@Injectable()
export class LiveService {
  server?: Server;
  emit(facilityId: string, event: string, data: unknown) {
    this.server?.to(`facility:${facilityId}`).emit(event, { facilityId, at: new Date().toISOString(), ...(data as object) });
  }
}

@WebSocketGateway({ namespace: '/live', cors: { origin: true, credentials: true } })
export class LiveGateway implements OnGatewayConnection {
  private log = new Logger('Live');
  @WebSocketServer() server!: Server;

  constructor(
    private live: LiveService,
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.live.server = server;
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? '';
      const payload = await this.jwt.verifyAsync(token, { secret: env().JWT_ACCESS_SECRET });
      client.data.userId = payload.sub;
    } catch {
      client.disconnect(true);
    }
  }

  /** Join a facility room. Authorised if user is a member of the owning tenant (with facility scope) or a platform admin. */
  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { facilityId: string }) {
    const facility = await this.prisma.parkingFacility.findUnique({ where: { id: body?.facilityId }, select: { id: true, tenantId: true } }).catch(() => null);
    if (!facility) return { ok: false, error: 'NOT_FOUND' };
    const m = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: facility.tenantId, userId: client.data.userId } } });
    const allowed = (m?.active && (m.facilityIds.length === 0 || m.facilityIds.includes(facility.id))) ||
      (await this.prisma.userRole.count({ where: { userId: client.data.userId, role: { scope: 'PLATFORM' } } })) > 0;
    if (!allowed) return { ok: false, error: 'FORBIDDEN' };
    await client.join(`facility:${facility.id}`);
    return { ok: true };
  }
}

@Global()
@Module({ providers: [LiveService, LiveGateway], exports: [LiveService] })
export class RealtimeModule {}
