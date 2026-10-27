import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';
import { MaxCodePoints } from './max-code-points.validator.js';

export class SearchInstrumentsQueryDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxCodePoints(255)
  query!: string;
}
