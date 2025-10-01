import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { CronModule } from '../cron/cron.module';

@Module({
  imports: [CronModule],
  controllers: [TestController],
})
export class TestModule {}