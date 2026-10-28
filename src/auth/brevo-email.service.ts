import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isEmail } from 'class-validator';

@Injectable()
export class BrevoEmailService {
  assertConfigured() {
    if (
      process.env.STAFF_EMAIL_OTP_ENABLED !== 'true' ||
      !process.env.BREVO_API_KEY ||
      !isEmail(process.env.BREVO_SENDER_EMAIL ?? '') ||
      (process.env.STAFF_OTP_SECRET?.length ?? 0) < 32
    ) {
      throw new ServiceUnavailableException(
        'ระบบยืนยันอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อโรงเรียน',
      );
    }
  }

  async sendOtp(email: string, code: string, registration: boolean) {
    this.assertConfigured();
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY!,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          sender: {
            email: process.env.BREVO_SENDER_EMAIL,
            name: 'DSPS Care',
          },
          to: [{ email }],
          subject: registration
            ? 'DSPS Care: ยืนยันการลงทะเบียนอีเมล'
            : 'DSPS Care: รหัสเข้าสู่ระบบ',
          textContent: `รหัส OTP ของคุณคือ ${code}\nรหัสมีอายุ 5 นาที และใช้ได้ครั้งเดียว\nอย่าแจ้งรหัสนี้ให้ผู้อื่น หากคุณไม่ได้ทำรายการ กรุณาติดต่อโรงเรียน`,
          tags: ['staff-otp'],
        }),
      });
      if (!response.ok) throw new Error('Email delivery rejected');
      // Never return or log Brevo's response, credentials, recipient, or OTP.
    } catch {
      throw new ServiceUnavailableException(
        'ส่ง OTP ไม่สำเร็จ กรุณารอ 60 วินาทีแล้วลองใหม่ หรือติดต่อโรงเรียน',
      );
    }
  }
}
