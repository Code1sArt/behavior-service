import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendTestNotificationDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
