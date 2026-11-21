import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeGateway } from './realtime.gateway';
import { CaseChatMessage } from './entities/case-chat-message.entity';
import { User } from '../users/entities/user.entity';
import { CaseAccessModule } from '../access/case-access.module';

/**
 * Realtime Module
 * WebSocket gateway: authenticated connections, identity-scoped rooms and case chat.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CaseChatMessage, User]),
    CaseAccessModule,
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
