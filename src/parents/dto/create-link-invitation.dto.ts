import { IsNotEmpty, IsString, Matches } from 'class-validator';
export class CreateLinkInvitationDto {
  @IsString() @IsNotEmpty() studentCitizenId!: string;
  @IsString() @Matches(/^\d{13}$/) parentCitizenId!: string;
}
