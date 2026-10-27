# Broadcast announcements

The Admin menu **Broadcast ข้อความ** at `/broadcast` sends announcements through
the existing notification inbox and Push outbox. All three API endpoints require
an authenticated `ADMIN`; other roles receive `403`.

## Audience

- Teachers: all `TEACHER` accounts or selected teachers.
- Students: all students assigned to classrooms in the active academic term, or
  selected students from that population.
- Classrooms: students in one or more selected classrooms in the active term.

Classroom announcements go to students themselves. Parents and classroom
advisors are not added as recipients. Each recipient gets one inbox entry,
regardless of whether they have registered a device.

## API

- `GET /notifications/broadcasts/options`: minimal teacher, student and classroom
  picker data plus inbox/Push availability.
- `POST /notifications/broadcasts/preview`: validate the audience and return the
  current `recipientCount` without creating notifications.
- `POST /notifications/broadcasts`: validate the audience again, save inbox
  entries and queue Push jobs in one transaction.

The preview body contains `audience` (`TEACHERS`, `STUDENTS`, `CLASSROOMS`),
`scope` (`ALL`, `SELECTED`), `userIds` and `classroomIds`. Both ID arrays are
required; unused arrays must be empty. Classrooms require `SELECTED` scope.

Sending adds a UUID v4 `requestId`, `title` (1–120 characters), `body`
(1–1,000 characters) and the preview's `recipientCount`. A changed recipient
count returns `409` so the administrator can review again. The response reports
`recipientCount`, newly created `inboxCount`, newly queued `queuedDeviceCount`
and `pushEnabled`. Queueing does not confirm delivery to a device.
Push text is shortened to 250 Unicode characters to bound device payload sizes;
the inbox and full-message dialog retain the complete announcement.

Retries of an unchanged draft reuse the same request ID and event keys; existing
inbox entries and device jobs are skipped using the database unique constraints.
The UI preserves the request ID after an uncertain response. A changed draft or
a successful send starts a new request. This protection lasts for the mounted
page session; it does not persist a draft across reloads. Existing Push worker
retries retain their at-least-once delivery behavior.

## Release

1. Deploy the backend changes in `behavior-service` before the Admin frontend.
   Broadcast uses the existing inbox/device/outbox tables and adds no migration.
2. Ensure the existing notification migrations have been applied and set
   `IN_APP_NOTIFICATIONS_ENABLED=true`. Sending stays disabled otherwise.
3. For device alerts, use the existing Firebase credentials/project and
   `PUSH_ENABLED=true`. Only registered devices with unexpired sessions are
   queued. With Push disabled, inbox announcements still work.
4. Release the Admin frontend changes in `admin-dspscare`.
5. Release the Flutter changes in `app_dspscare` for the announcement icon,
   full-message dialog and navigation from a broadcast Push to the inbox.

The code checks and automated tests use mocks. Verify a selected test account on
a registered device after deployment before broadcasting a real announcement.

## Checks

```sh
npm run build
npm test -- --runInBand notifications
```

In the Flutter project:

```sh
flutter test test/notification_inbox_test.dart
flutter analyze lib/features/home_page.dart lib/features/notification_inbox_page.dart
```
