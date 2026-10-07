import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** Like or dislike a cited knowledge source (CLEAN-138). */
export class SourceRatingDto {
  @ApiProperty({ enum: [1, -1], description: '1 = this source helped, -1 = it did not.' })
  @IsIn([1, -1])
  rating: 1 | -1;
}

export class SourceRatingResultDto {
  @ApiProperty({ enum: [1, -1] })
  rating: 1 | -1;
}
