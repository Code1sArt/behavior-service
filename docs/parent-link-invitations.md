# Shared classroom parent invitations

School staff select a classroom and issue one reusable, case-sensitive code for
that room. Every code is exactly five characters and contains at least one
lowercase letter, uppercase letter, and digit from `a-zA-Z0-9`. Codes expire
after 24 hours. Issuing another code replaces the previous code for that room.
Only the SHA-256 hash is stored; the plaintext is returned on issuance only.

## API

- `POST /parents/classroom-invitations` — ADMIN/AFFAIRS JWT, `{ "classroomId": 1 }`.
  Returns `invitationCode`, `expiresAt`, and `classroom: { id, name }`.
- `POST /parents/classroom-invitations/resolve` — `{ "invitationCode": "aB3xY" }`.
  Returns the room and unlinked students as `{ id, firstName, lastName }`.
  The code is sent in the POST body, not the URL. Lookup does not consume it.
- `POST /parents/register` — parent account details plus a nonempty `students`
  array of `{ "studentId": "student-uuid", "invitationCode": "aB3xY" }`.
  Every selected student needs a valid code for their current room. Selections
  can include different rooms. Registration creates one account and links all
  students in one transaction, or rolls back the whole registration.
- `PATCH /parents/children` — PARENT JWT, the same `students` array. Adds all
  selected students to the authenticated parent in one transaction.
- `DELETE /parents/children/:studentId` — PARENT JWT. Removes only that parent's
  relationship to that student. It does not delete the account, student,
  attendance, or behavior data. Removing the last child is allowed.
- `GET /users/me` — returns the current parent's complete `children` list.

Arrays accept 1–100 unique students. Already-linked students cannot be claimed
or replaced. Roster membership, code expiry, and availability are checked again
at submission, including an update condition on both student and classroom.
Shared codes remain usable by other parents until expiry or replacement.
Room-code lookups, registration and adding children are limited by persistent
IP counters shared by API processes (120 requests/minute). IPs are hashed in
`EmailOtpBucket`; counters use the `parent-link:` prefix.

The admin panel issues the room code. The LINE web registration and native app
registration let parents choose several students, and their profile contains
management controls to add or remove children later. Parents need the new
room code when adding students after expiry or code rotation.

## Compatibility

Legacy `POST /parents/link-invitations` and `PATCH /parents/add-child` remain
available for older clients. Legacy single-student registration payloads remain
supported. Old parent-bound invitations still require the original parent ID.
The legacy add-child flow also accepts a current classroom code for a student
from that room. Admin provisioning remains available without a code.

## Deployment

Deploy backend changes and database migrations before the new clients:

```sh
npx prisma migrate deploy
npx prisma generate
npm run build
```

New migration: `20261106100000_classroom_parent_invitations`. It creates
`ParentClassroomInvitation`, with one row per classroom and a unique token hash;
existing student-specific invitation records and parent-child links are retained.
Use the project's normal database migration process. Updating the clients alone
is insufficient. These commands have not been run against a shared/production
database as part of local implementation.

## Verification

```sh
npm test -- --runInBand
npm run build
npx prisma validate
```
