import {
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class LineIdentityService {
  async verify(accessToken?: string, expectedUserId?: string): Promise<string> {
    if (!accessToken)
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบ LINE ใหม่');
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    if (!channelId)
      throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่า LINE Login');
    try {
      const { data } = await axios.get(
        'https://api.line.me/oauth2/v2.1/verify',
        {
          params: { access_token: accessToken },
          timeout: 10000,
        },
      );
      if (
        String(data.client_id) !== channelId ||
        !(Number(data.expires_in) > 0)
      )
        throw new Error();
      const profile = await axios.get('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      });
      const id = profile.data.userId;
      if (
        typeof id !== 'string' ||
        !id ||
        (expectedUserId && expectedUserId !== id)
      )
        throw new Error();
      return id;
    } catch {
      // Never log Axios errors: they contain the LINE credential in request config.
      throw new UnauthorizedException(
        'ไม่สามารถยืนยันบัญชี LINE กรุณาเข้าสู่ระบบใหม่',
      );
    }
  }
}
