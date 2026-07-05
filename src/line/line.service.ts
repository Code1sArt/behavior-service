import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
// 1. เปลี่ยนการ Import มาดึงจากหมวด messagingApi แทน
import { messagingApi } from '@line/bot-sdk';
import { PrismaService } from '../prisma/prisma.service';

const { MessagingApiClient } = messagingApi;

@Injectable()
export class LineService {
  // 2. ใช้ MessagingApiClient แทน Client เดิม
  private client: messagingApi.MessagingApiClient;
  private readonly logger = new Logger(LineService.name);
  private readonly channelAccessToken: string;

  constructor(private readonly prisma: PrismaService) {
    this.channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    this.client = new MessagingApiClient({
      // ใน SDK ใหม่ ใช้แค่ Token ตัวเดียวก็พอครับ ไม่ต้องใส่ Secret แล้วสำหรับการส่งข้อความ
      channelAccessToken: this.channelAccessToken,
    });
  }

  async sendPushMessage(lineUserId: string, text: string) {
    if (!lineUserId) return false;

    try {
      // 3. ท่ายิง API ของเวอร์ชันใหม่ จะต้องครอบด้วย Object { to, messages }
      await this.client.pushMessage({
        to: lineUserId,
        messages: [
          {
            type: 'text',
            text: text,
          },
        ],
      });
      this.logger.log(`ส่ง LINE แจ้งเตือนสำเร็จ -> ${lineUserId}`);
      return true;
    } catch (error: unknown) {
      // ป้องกัน Error แดงเถือกกรณี LINE ล่ม
      this.logger.error(
        `ไม่สามารถส่ง LINE ไปที่ ${lineUserId} ได้`,
        error instanceof Error ? error.stack || error.message : String(error),
      );
      return false;
    }
  }

  async findLinkedUsers() {
    return this.prisma.user.findMany({
      where: {
        AND: [{ lineUserId: { not: null } }, { lineUserId: { not: '' } }],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        classroom: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async sendTestNotification(userId: string, message?: string) {
    if (!this.channelAccessToken) {
      throw new ServiceUnavailableException(
        'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        lineUserId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('ไม่พบผู้ใช้ที่เลือก');
    }
    if (!user.lineUserId) {
      throw new BadRequestException('ผู้ใช้รายนี้ยังไม่ได้ผูกบัญชี LINE');
    }

    const recipientName = `${user.firstName} ${user.lastName}`.trim();
    const text =
      message?.trim() ||
      `🔔 ทดสอบการแจ้งเตือนจาก DSPS CARE\n\nเรียน ${recipientName}\nหากได้รับข้อความนี้ แสดงว่าบัญชี LINE ของคุณเชื่อมต่อกับระบบเรียบร้อยแล้ว`;
    const sent = await this.sendPushMessage(user.lineUserId, text);

    if (!sent) {
      throw new BadGatewayException(
        'LINE ไม่สามารถส่งข้อความไปยังผู้ใช้รายนี้ได้',
      );
    }

    return {
      success: true,
      message: 'ส่งข้อความทดสอบสำเร็จ',
      recipient: {
        id: userId,
        name: recipientName,
      },
    };
  }
}
