import { IsIn, IsString, Length } from 'class-validator';

export class DeviceTokenDto {
  @IsString()
  @Length(16, 4096)
  token!: string;
}

export class RegisterDeviceDto extends DeviceTokenDto {
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';
}
