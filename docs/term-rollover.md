# Term rollover

Term rollover moves the current roster from one term to the next without
resetting point accounts or changing existing attendance and behavior records.
Only administrators can use these endpoints.

## Prerequisites

- The target academic term already exists and is later in the same school year.
- Student history backfill has completed with zero blocking issues.
- Student score verification passes.
- The target term does not already contain roster or historical activity.

## Preview

Preview is read-only:

```http
POST /promotions/term-rollover/preview
Content-Type: application/json

{
  "sourceTermId": 1,
  "targetTermId": 2
}
```

The response lists rooms that will be created or reused, student counts,
student names and planned actions for the Admin exception editor, and blocking
issues. Apply must not be called while `blockingIssues` is greater than zero.

Room names can be overridden:

```json
{
  "sourceTermId": 1,
  "targetTermId": 2,
  "classroomMappings": [
    { "sourceClassroomId": 10, "targetName": "ม.1/1" }
  ]
}
```

Student exceptions support:

- `MOVE`: move to the cloned room identified by `targetSourceClassroomId`.
- `TRANSFER_OUT`: end enrollment and clear the current classroom.
- `SKIP`: leave the student unchanged for manual handling.

## Apply

Apply requires a stable idempotency key:

```http
POST /promotions/term-rollover/apply
Content-Type: application/json

{
  "sourceTermId": 1,
  "targetTermId": 2,
  "idempotencyKey": "rollover-2569-term-2",
  "activateTargetTerm": true
}
```

The operation runs in one database transaction. It clones room settings and
advisors, closes source enrollments, creates target enrollments, updates current
classrooms, records the promotion audit, and activates the target term. Any
failure rolls back the full operation.

Point accounts and existing attendance or behavior records are never updated by
term rollover. Repeating Apply with the same key returns the original batch.
