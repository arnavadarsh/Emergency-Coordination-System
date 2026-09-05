import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { CaseChatMessage } from './entities/case-chat-message.entity';

/**
 * Realtime Module
 * Provides WebSocket functionality with JWT authentication
 * Phase 0: Foundation only, no business logic
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CaseChatMessage]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
