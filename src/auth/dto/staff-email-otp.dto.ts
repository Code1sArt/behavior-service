import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Role } from '@prisma/client';
import { STAFF_ROLES } from '../staff-otp.policy';

export class StaffLoginRequestDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password!: string;

  @IsIn(STAFF_ROLES)
  role!: Role;
}

export class StaffRegisterRequestDto extends StaffLoginRequestDto {
  @IsString()
  @Matches(/^[0-9]{13}$/)
  citizenId!: string;
}

export class StaffOtpVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}
