import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, SavedLocation } from './entities';

/**
 * Users Module
 * Manages user data and profiles
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, SavedLocation])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
