import { Controller, Post, Body } from '@nestjs/common';
import { ClassificationService } from './classification.service';

@Controller('classify')
export class ClassificationController {
  constructor(private readonly service: ClassificationService) {}

  @Post()
  classify(@Body('description') description: string) {
    return this.service.classify(description);
  }
}
