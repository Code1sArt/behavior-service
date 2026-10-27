import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class BroadcastAudienceDto {
  @IsIn(['TEACHERS', 'STUDENTS', 'CLASSROOMS'])
  audience!: 'TEACHERS' | 'STUDENTS' | 'CLASSROOMS';

  @IsIn(['ALL', 'SELECTED'])
  scope!: 'ALL' | 'SELECTED';

  @IsArray()
  @ArrayMaxSize(10000)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds!: string[];

  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  classroomIds!: number[];
}

export class SendBroadcastDto extends BroadcastAudienceDto {
  @IsUUID('4')
  requestId!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 120)
  title!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 1000)
  body!: string;

  @IsInt()
  @Min(1)
  recipientCount!: number;
}
