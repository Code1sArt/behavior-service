import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
export class CreateLinkInvitationDto {
  @IsString() @IsNotEmpty() studentCitizenId!: string;
  @IsOptional() @IsString() @Matches(/^\d{13}$/) parentCitizenId?: string;
}
