# Student enrollment changes

The admin workflow supports three audited operations without deleting academic
history:

- `TRANSFER_OUT` ends the active enrollment with exit reason `TRANSFERRED`.
- `STUDY_LEAVE` ends the active enrollment with exit reason `STUDY_LEAVE`.
- `RETURN_TO_STUDY` creates a new active enrollment in a classroom belonging to
  the selected term. It is accepted only when the student has no active
  enrollment and their latest eligible history is `STUDY_LEAVE` or `TRANSFERRED`.

All writes for a request run in one transaction. Each apply request requires an
idempotency key and writes `EnrollmentChangeBatch` plus one
`EnrollmentChangeItem` per student.

## Endpoints

- `GET /promotions/enrollment-changes/candidates?termId=:id`
- `POST /promotions/enrollment-changes/preview`
- `POST /promotions/enrollment-changes/apply`

Preview and apply accept the same plan:

```json
{
  "termId": 1,
  "changes": [
    { "studentId": "student-uuid", "action": "STUDY_LEAVE" },
    {
      "studentId": "returning-student-uuid",
      "action": "RETURN_TO_STUDY",
      "targetClassroomId": 10
    }
  ]
}
```

Apply also requires `idempotencyKey`.

## Rollback

Application changes can be reverted normally before the workflow is used. For
the database schema, use the guarded script at
`prisma/rollbacks/20260714090000_add_study_leave_enrollment_exit_reason/rollback.sql`
only after a verified backup.

The script deliberately aborts if enrollment-change audit rows,
`STUDY_LEAVE` enrollment data, or promotion batches that conflict with the old
unique key exist. If it aborts, keep the schema and perform a reviewed data
reconciliation instead of deleting history.
