import { Module } from '@nestjs/common';
import { SettingModule } from '#/setting/setting.module';
import { TextractRepository } from './textract.repository';

@Module({
  imports: [SettingModule],
  providers: [TextractRepository],
  exports: [TextractRepository],
})
export class TextractModule {}
