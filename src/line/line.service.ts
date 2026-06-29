import { Injectable, Logger } from '@nestjs/common';
// 1. เปลี่ยนการ Import มาดึงจากหมวด messagingApi แทน
import { messagingApi } from '@line/bot-sdk';

const { MessagingApiClient } = messagingApi;

@Injectable()
export class LineService {
    // 2. ใช้ MessagingApiClient แทน Client เดิม
    private client: messagingApi.MessagingApiClient;
    private readonly logger = new Logger(LineService.name);

    constructor() {
        this.client = new MessagingApiClient({
            // ใน SDK ใหม่ ใช้แค่ Token ตัวเดียวก็พอครับ ไม่ต้องใส่ Secret แล้วสำหรับการส่งข้อความ
            channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
        });
    }

    async sendPushMessage(lineUserId: string, text: string) {
        if (!lineUserId) return;

        try {
            // 3. ท่ายิง API ของเวอร์ชันใหม่ จะต้องครอบด้วย Object { to, messages }
            await this.client.pushMessage({
                to: lineUserId,
                messages: [
                    {
                        type: 'text',
                        text: text,
                    }
                ],
            });
            this.logger.log(`ส่ง LINE แจ้งเตือนสำเร็จ -> ${lineUserId}`);
        } catch (error: any) {
            // ป้องกัน Error แดงเถือกกรณี LINE ล่ม
            this.logger.error(
                `ไม่สามารถส่ง LINE ไปที่ ${lineUserId} ได้`,
                error.response?.data || error.message
            );
        }
    }
}