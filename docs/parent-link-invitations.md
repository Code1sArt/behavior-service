# Student-specific parent link invitations

School staff can select a classroom in the admin panel and issue a separate code
for each student without collecting parent citizen IDs. The admin panel sends
`POST /parents/link-invitations` with `{ "studentCitizenId": "S0001" }` for each
student. Only authenticated `ADMIN` and `AFFAIRS` accounts can issue codes.

Codes expire after 24 hours and can be used once, for the specified student only.
Send each code directly to that student's guardian. Public parent registration
and adding a child still require a valid school code. The parent supplies their
own account details; staff do not enter them during issuance.

The database stores a hash of the code. Newly issued codes have a nullable
`parentCitizenId`; claiming the code records the claiming parent's citizen ID in
the same transaction as consuming the code and linking the student. Codes issued
by older clients with a parent citizen ID retain that binding and cannot be
claimed by a different parent. Existing student-parent links cannot be replaced.

## Deployment

Deploy the database migration and updated backend before updating the admin panel:

```sh
npx prisma migrate deploy
npx prisma generate
npm run build
```

Migration `20261106090000_student_only_parent_link_invitation` makes
`ParentLinkInvitation.parentCitizenId` nullable and preserves existing values.
Follow the project's normal database migration process. Parent registration
clients continue sending the same registration payload, including the school
invitation code.

## Verification

```sh
npm test -- --runInBand parents
```
