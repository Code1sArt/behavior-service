# Annual promotion

Annual promotion moves students into term 1 of the next school year while
preserving cumulative point accounts and all historical records.

## Preview

Every source classroom requires an explicit mapping. The API never guesses
grade names:

```http
POST /promotions/annual/preview
Content-Type: application/json

{
  "sourceTermId": 2,
  "targetTermId": 3,
  "classroomMappings": [
    {
      "sourceClassroomId": 10,
      "targetName": "ม.2/1",
      "defaultAction": "MOVE"
    },
    {
      "sourceClassroomId": 60,
      "defaultAction": "GRADUATE"
    }
  ]
}
```

Supported actions are:

- `MOVE`: promote into the mapped target classroom.
- `REPEAT`: create a new enrollment without advancing the student.
- `GRADUATE`: end enrollment and clear the current classroom.
- `TRANSFER_OUT`: end enrollment as transferred and clear the current room.
- `SKIP`: leave the student unchanged for manual handling.

Individual exceptions use `studentOverrides`. For `MOVE` or `REPEAT`,
`targetSourceClassroomId` points to the classroom mapping whose target room
should receive the student.

Preview is read-only and returns each student's planned action for the Admin
exception editor. Resolve every blocking issue before Apply.

## Apply

```http
POST /promotions/annual/apply
Content-Type: application/json

{
  "sourceTermId": 2,
  "targetTermId": 3,
  "idempotencyKey": "annual-2569-to-2570",
  "activateTargetTerm": true,
  "classroomMappings": [
    {
      "sourceClassroomId": 10,
      "targetName": "ม.2/1",
      "defaultAction": "MOVE"
    },
    {
      "sourceClassroomId": 60,
      "defaultAction": "GRADUATE"
    }
  ]
}
```

The operation uses the same atomic engine as term rollover. It creates or
reuses empty target rooms, copies advisors and thresholds, closes source
enrollments with the correct reason, creates target enrollments, records audit
items, and activates the target term.

`StudentPointAccount`, attendance records, and behavior records are never
updated by annual promotion. Repeating Apply returns the original batch.
