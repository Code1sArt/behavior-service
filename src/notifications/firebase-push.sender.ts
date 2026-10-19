import { Injectable } from '@nestjs/common';
import {
  App,
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PushKind } from './notifications.service';

@Injectable()
export class FirebasePushSender {
  private app?: App;
  async send(token: string, kind: PushKind, eventId: string) {
    if (!this.app) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      if (projectId !== 'dsps-care')
        throw new Error('FIREBASE_PROJECT_ID must be dsps-care');
      this.app =
        getApps().find((app) => app.name === 'dsps-care-push') ??
        initializeApp(
          {
            credential: applicationDefault(),
            projectId,
          },
          'dsps-care-push',
        );
    }
    // Only generic text on the lock screen. Details are fetched through authenticated APIs.
    return getMessaging(this.app).send({
      token,
      notification: {
        title: 'DSPS Care',
        body: 'มีข้อมูลใหม่จากโรงเรียน กรุณาเปิดแอปเพื่อตรวจสอบ',
      },
      data: { kind, eventId },
      android: { priority: 'high', ttl: 60 * 60 * 1000 },
      apns: {
        headers: {
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
        },
        payload: { aps: { sound: 'default' } },
      },
    });
  }
}
