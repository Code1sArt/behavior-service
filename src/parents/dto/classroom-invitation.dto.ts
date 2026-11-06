import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateClassroomInvitationDto {
  @IsInt()
  @Min(1)
  classroomId!: number;
}

export class ResolveClassroomInvitationDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9]{5}$/)
  invitationCode!: string;
}

export class StudentLinkSelectionDto extends ResolveClassroomInvitationDto {
  @IsString()
  @Matches(/\S/)
  studentId!: string;
}

export class AddChildrenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StudentLinkSelectionDto)
  students!: StudentLinkSelectionDto[];
}
