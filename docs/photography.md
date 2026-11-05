# ระบบจองช่างภาพ

ระบบนี้เพิ่มตารางในฐานข้อมูลเดิมและอ้างอิง `User.id` เดิม ไม่สร้างบัญชีหรือรหัสผ่านซ้ำ
API, Admin และ LINE Mini App ปล่อยแยกจาก Mobile App ได้ โดย Mobile App ต้อง build/release ของตนเองภายหลัง

## สิทธิ์และหน้าจอ

| ผู้ใช้ | การใช้งาน |
| --- | --- |
| Admin | เมนู **ระบบจองช่างภาพ** ใน Admin เดิม: กำหนด/ถอนสิทธิ์ครูผู้รับผิดชอบ ดูและจัดการคำขอทั้งหมด จัดทีมและรายการอุปกรณ์ |
| ครูผู้รับผิดชอบ | เมนู **จองช่างภาพ** ใน LINE Mini App และ Mobile App: ดูทุกคำขอ เลือกนักเรียนเข้าทีม เปิด/พักการรับงาน เพิ่ม/ปิดอุปกรณ์ กำหนดจำนวนอุปกรณ์ จัดการกลุ่มงาน อนุมัติพร้อมมอบหมายช่างภาพ หรือไม่อนุมัติพร้อมเหตุผล |
| ครู/ฝ่ายกิจการ | สร้างคำขอ ดูคำขอของตนเอง ยกเลิกก่อนเริ่มงานพร้อมเหตุผล |
| นักเรียน | เมนู **งานช่างภาพของฉัน**: ดูเฉพาะงานที่ได้รับมอบหมาย รวมถึงรายละเอียด วันเวลา สถานที่ ผู้จอง อาหารกลางวัน และทีมงาน |
| ผู้ปกครอง | ไม่มีสิทธิ์ใช้โมดูลนี้ |

Admin เป็นผู้กำหนดผู้รับผิดชอบได้เท่านั้น และเลือกได้เฉพาะบัญชี `TEACHER`
ผู้รับผิดชอบเพิ่มได้เฉพาะบัญชี `STUDENT` เข้าทีมช่างภาพ
การพักการรับงานป้องกันการมอบหมายใหม่ แต่ยังรักษารายการงานเดิมไว้ให้นักเรียนดูได้
สิทธิ์ตรวจจากข้อมูลปัจจุบันในฐานข้อมูล ไม่เชื่อบทบาทจาก client หรือ JWT เก่า

## แบบฟอร์มและกติกา

- ผู้จองใช้บัญชีที่ล็อกอินจาก server เสมอ client เปลี่ยนผู้จองแทนคนอื่นไม่ได้
- ชื่อกิจกรรม กลุ่มสาระ/กลุ่มงาน (dropdown) และสถานที่เป็นข้อมูลบังคับ
- มีตัวเลือกกลุ่มสาระและกลุ่มงานเริ่มต้น 13 รายการ ผู้รับผิดชอบเพิ่มและปิดรายการได้
- เลือกได้ 1–31 ช่วงเวลา แต่ละช่วงข้ามวันได้ หรือเพิ่มแยกตามวันได้
- เลือกวันผ่านปฏิทินใน Admin, LINE Mini App และ Mobile App โดยแสดงวันและช่วงเวลาของคำขอ `PENDING`/`APPROVED` ของทุกผู้จอง แยกตามชนิดคำขอ ไม่แสดงข้อมูลผู้จอง และยังเลือกส่งคำขอในช่วงเวลาซ้ำได้
- Admin ลบการจองถาวรได้ทุกสถานะผ่านปุ่มยืนยันในหน้ารายละเอียดงาน โดยคืนคิวช่างภาพ/อุปกรณ์และนำรายการออกจากปฏิทิน ครูผู้รับผิดชอบและผู้จองไม่มีสิทธิ์ลบ
- ทุกช่วงต้องอยู่ในอนาคต เริ่มก่อนสิ้นสุด และช่วงของคำขอเดียวกันต้องไม่ซ้อนกัน
- หน้าจอใช้เวลาประเทศไทย (+07:00) ทั้งเว็บและมือถือ แม้อุปกรณ์ตั้งเขตเวลาอื่น
- คำขอช่างภาพระบุจำนวน 1–50 คน ตอนอนุมัติต้องเลือกนักเรียนในทีมที่เปิดรับงานให้ครบจำนวนโดยไม่ซ้ำ
- ตัวเลือก **ยืมอุปกรณ์แทนการขอช่างภาพ** เปลี่ยนชนิดคำขอเป็นยืมอุปกรณ์ จำนวนช่างภาพเป็น 0 และต้องเลือกอุปกรณ์พร้อมจำนวนอย่างน้อย 1 รายการ
- ตัวเลือกอาหารกลางวันเป็นมี/ไม่มี
- รายการใหม่เป็น `PENDING` จากนั้นเป็น `APPROVED` หรือ `REJECTED`
- ผู้จองหรือผู้รับผิดชอบยกเลิก `PENDING`/`APPROVED` ก่อนงานเริ่มได้ พร้อมเหตุผล (`CANCELLED`)
- ปฏิเสธคำขอที่เริ่มงานไปแล้ว ไม่อนุมัติ/ยกเลิกซ้ำ การเปลี่ยนผู้รับผิดชอบหรือพักทีมไม่ลบประวัติ

ใช้ transaction พร้อมล็อกแถว `PhotographyMutex(id=1)` ก่อนแก้ไขข้อมูลในโมดูล
เพื่อตรวจงานชนและจำนวนอุปกรณ์จากข้อมูลล่าสุด รวมถึงเมื่อมี backend หลาย process
การอนุมัติที่เวลาทับกันจะถูกปฏิเสธด้วย HTTP 409 หากช่างภาพไม่ว่างหรืออุปกรณ์ไม่พอ
นับจำนวนอุปกรณ์ตามยอดที่ใช้พร้อมกันจริง ช่วงที่สิ้นสุดตรงเวลาเริ่มงานถัดไปไม่ถือว่าชนกัน
การยกเลิกคืนช่วงเวลานั้นให้จองได้ โดยยังเก็บประวัติการมอบหมายเดิม

## การแจ้งเตือน

- คำขอใหม่แจ้งครูผู้รับผิดชอบ
- อนุมัติ/ไม่อนุมัติแจ้งผู้จอง อนุมัติช่างภาพแล้วแจ้งนักเรียนที่ได้รับมอบหมายโดยตรง
- ยกเลิกแจ้งผู้จอง ครูผู้รับผิดชอบ และนักเรียนที่ถูกมอบหมาย
- บันทึก inbox และคิว push/LINE ใน transaction เดียวกับการจอง หากบันทึกคิวไม่สำเร็จ จะไม่บันทึกการอนุมัติบางส่วน
- Inbox ใช้ `IN_APP_NOTIFICATIONS_ENABLED=true`; mobile push ใช้ `PUSH_ENABLED=true` และ Firebase/device registration เดิม
- LINE ใช้บัญชีที่ผูก LINE และ `LINE_CHANNEL_ACCESS_TOKEN` เดิม มี outbox retry สูงสุด 8 ครั้ง ข้ามรายการที่บัญชียกเลิกการผูก LINE และเก็บสถานะล้มเหลวไว้ให้ตรวจสอบ
- LINE มีรายละเอียดงานและลิงก์ (ถ้าตั้งค่าไว้) ส่วนการแตะ mobile push หรือ inbox เปิดรายละเอียดงานตาม booking ID
- รูปแบบ event ID คือ `photography:<bookingId>:<eventUuid>` ไม่รวมข้อมูลลับ
- Worker ส่งหลัง transaction commit และอาจส่งซ้ำได้หาก process ล่มหลังผู้ให้บริการรับข้อความ แต่ก่อนบันทึกสถานะสำเร็จ
- รายการงานยังดูได้จากเมนู แม้อุปกรณ์ไม่ได้ลงทะเบียน push หรือไม่ได้ผูก LINE

## เปิดใช้ภายหลังเมื่อพร้อม deploy

ขั้นตอนต่อไปนี้ยังไม่ได้ทำกับฐานข้อมูลจริง:

1. สำรองและทดสอบ restore ตาม [database-migrations.md](database-migrations.md)
2. ตรวจและรัน migration `20261105090000_photography_booking` ตามขั้นตอน migration ปกติ ห้ามใช้ `db push` แทน
3. Generate Prisma Client และ build backend จาก schema ใหม่
4. ตั้งค่า `PHOTOGRAPHY_ENABLED=true` หลัง migration สำเร็จ (ค่าเริ่มต้นเป็นปิด)
5. เปิด inbox/push ตามช่องทางที่จะใช้ ตรวจ Firebase และ LINE configuration เดิม
6. ถ้าต้องการลิงก์ใน LINE ตั้ง `PHOTOGRAPHY_MINI_APP_URL` เป็น HTTPS URL ที่เปิดหน้า `/photography` ของ Mini App ได้ เช่น LIFF URL ที่ชี้หน้านี้ server เพิ่ม `bookingId` ใน query ให้
7. Build/release Admin และ LINE Mini App รวมถึง Mobile App รุ่นที่มีเมนูใหม่
8. Admin เลือกครูผู้รับผิดชอบ ครูเพิ่มนักเรียนเข้าทีมและอุปกรณ์ แล้วทดสอบคำขอหนึ่งงานด้วยบัญชีทดสอบ

ไม่ต้องเพิ่ม connection string ใหม่ และไม่ต้องเปลี่ยน `DATABASE_URL`
ไม่มีการแก้ `.env` จริงโดยงานพัฒนาครั้งนี้
ปิด `PHOTOGRAPHY_ENABLED` เพื่อปิด API และ LINE worker ได้โดยไม่ลบตารางหรือประวัติ
คิว mobile push ที่บันทึกแล้วใช้ push worker กลางเดิม

## อัปเดตปฏิทินเลือกวัน

ปล่อย API ที่มี `GET /photography/calendar` ก่อนอัปเดตเว็บและ Mobile App ไม่ต้องเพิ่ม migration หรือ environment variable สำหรับการเปลี่ยนแปลงปฏิทินนี้ กติกาอนุมัติและการตรวจช่างภาพ/อุปกรณ์ซ้ำยังใช้ตามเดิม

## API

ทุก endpoint ต้องใช้ JWT เดิม ขึ้นต้น `/photography`

| Endpoint | การใช้งาน |
| --- | --- |
| `GET /metadata` | สิทธิ์ ผู้ใช้ปัจจุบัน รายการกลุ่มงานและอุปกรณ์ |
| `GET /managers`, `PATCH /managers/:userId` | Admin จัดการผู้รับผิดชอบ (`{active}`) |
| `GET /directory?role=STUDENT&q=...` | ผู้รับผิดชอบค้นหานักเรียน อย่างน้อย 2 ตัวอักษร ครั้งละไม่เกิน 50 คน |
| `GET /directory?role=TEACHER&q=...` | Admin ค้นหาครูสำหรับมอบสิทธิ์ |
| `GET /photographers`, `PATCH /photographers/:userId` | จัดทีมช่างภาพ (`{active}`) |
| `POST /departments`, `PATCH /departments/:id` | เพิ่มกลุ่มงาน (`{name}`) / เปิดปิด (`{active}`) |
| `POST /equipment`, `PATCH /equipment/:id` | เพิ่มหรือปรับจำนวนด้วยชื่อเดิม (`{name,quantity}`) / เปิดปิด (`{active}`) |
| `GET /bookings?status=PENDING&page=1` | รายการตามสิทธิ์ แบ่งหน้าครั้งละ 30 รายการ |
| `GET /calendar?month=2030-01` | ผู้มีสิทธิ์จองดูช่วงเวลารออนุมัติ/อนุมัติแล้วที่ทับซ้อนเดือนตามเวลาไทย คืน `id, startsAt, endsAt, kind, status` โดยไม่มีข้อมูลผู้จอง |
| `POST /bookings` | สร้างคำขอ |
| `GET /bookings/:id` | รายละเอียดตามสิทธิ์ |
| `DELETE /bookings/:id` | เฉพาะ Admin ลบรายการถาวรได้ทุกสถานะ รวมงานที่เริ่มแล้ว ลบช่วงเวลา การมอบหมาย รายการยืมอุปกรณ์ และแจ้งเตือนที่เกี่ยวข้องใน transaction เดียวกัน |
| `GET /bookings/:id/availability` | ผู้รับผิดชอบดูช่างภาพที่ว่าง/ติดงานทุกช่วงของคำขอ |
| `POST /bookings/:id/approve` | อนุมัติ (`{studentIds,note?}`; ยืมอุปกรณ์ใช้ `studentIds:[]`) |
| `POST /bookings/:id/reject`, `POST /bookings/:id/cancel` | ไม่อนุมัติ / ยกเลิก (`{note}`) |

ตัวอย่างสร้างคำขอ (เวลาต้องอยู่ในอนาคต):

```json
{
  "kind": "PHOTOGRAPHERS",
  "activityName": "กิจกรรมโรงเรียน",
  "departmentId": "photo-dept-thai",
  "location": "หอประชุม",
  "photographerCount": 2,
  "hasLunch": true,
  "slots": [
    {"startsAt": "2030-01-02T09:00:00+07:00", "endsAt": "2030-01-02T12:00:00+07:00"},
    {"startsAt": "2030-01-04T09:00:00+07:00", "endsAt": "2030-01-04T12:00:00+07:00"}
  ],
  "equipment": []
}
```

## การทดสอบ

- `npm test -- --runInBand`: regression suite และกติกาช่วงเวลา/stock รวมถึง LINE worker (mock; ไม่ส่งข้อความจริง)
- `npm run build`: ตรวจ TypeScript และสร้าง backend
- `npm run build` ใน `admin-dspscare` และ `dsps_care`: ตรวจและ build เว็บ
- `flutter analyze --no-pub` และ `flutter test --no-pub` ใน `app_dspscare`: ตรวจและทดสอบมือถือ รวมถึงฟอร์มหลายวัน การอนุมัติ สิทธิ์นักเรียน และเปิดงานจาก inbox
- `npm run test:photography:db`: HTTP workflow และ concurrency บน MySQL จริงสำหรับทดสอบเท่านั้น ต้องเตรียม schema ด้วย migration ทั้งหมด และกำหนด `PHOTOGRAPHY_TEST_DATABASE_URL` เอง suite จะปฏิเสธ host นอกเครื่อง, database ที่ไม่ใช่ `photography_test`, หรือ port เริ่มต้น 3306 ไม่ใช้ `DATABASE_URL` ในการเชื่อมต่อฐานข้อมูลทดสอบ

**Database test ล้างข้อมูลใน database ทดสอบที่ระบุทุกกรณี ห้ามใช้ฐานข้อมูลที่มีข้อมูลต้องเก็บ**
ไม่มี worker ส่ง push/LINE จริงในชุดทดสอบ database

## Production workflow

GitHub Actions saves a consistent database snapshot, the compiled API, and the previous `.env` in a private directory outside the deploy root before uploading source or running migrations. It streams the snapshot over SSH to a disposable MariaDB 10.11 service, restores it, checks its tables, and removes the temporary file. Dumps are never uploaded as public artifacts or printed in logs.

When the photography migration is new, the workflow checks initialization and enables `PHOTOGRAPHY_ENABLED` and the Mini App link before restarting. Existing notification channel settings are preserved. Later deployments preserve the existing photography enablement setting.

Smoke checks read health, metadata, and booking lists and check Admin, student, and anonymous permissions. They do not create bookings or send messages. If release or smoke verification fails, the workflow restores the previous compiled API and environment while retaining additive migrations.

The `inspect` workflow operation reads production status without deploying. Mobile App distribution remains separate.
