// ellucian.module.ts
import { Module } from '@nestjs/common';
import { EllucianService } from './ellucian.service';
import { HttpModule } from '@nestjs/axios';
import { RedisService } from '../services/redis.service';


@Module({
  imports: [HttpModule],
  providers: [EllucianService, RedisService],
  exports: [EllucianService],
})
export class EllucianModule {}
