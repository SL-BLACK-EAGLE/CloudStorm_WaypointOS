# API

Most writes are **server actions** (typed, CSRF-safe, called from the UI). **Route handlers** exist only where a non-React caller needs HTTP: the offline driver app, file upload and download, the notification bell, and QStash jobs.

Every endpoint checks the caller's role and scope on the server (`requireUser` / `userForApi`). Inputs are validated with Zod, and errors come back as `{ ok: false, error }` with a message a person can act on.

## Route handlers

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/sync` | driver | Apply a batch of offline events (`trip.depart`, `stop.arrive`, `stop.deliver`, `stop.exception`) in device sequence order. Returns an outcome per event: `APPLIED`, `APPLIED_WITH_CONFLICT`, `DUPLICATE` or `REJECTED`. Rate-limited through Redis. |
| `GET /api/sync` | driver | The current run pack: trips, stops, windows, docks, conflicts and dispatcher notices. |
| `POST /api/uploads` | signed in | Upload an image (signature, PoD, damage or shortfall photo) to object storage. The type and size are checked, and the call is rate-limited. Returns the storage key. |
| `GET /api/files/{key}` | signed in | Serve a stored image. |
| `GET /api/notifications` | signed in | The latest 30 notifications for the caller (to them, to their role in their depot, or to their outlet) and the unread count. |
| `POST /api/notifications` | signed in | `{ ids?: string[] }` marks those notifications, or all of them, as read. |
| `POST /api/jobs/{job}` | QStash | Signed background job. The signature is checked against the current and next signing keys. `relay` sweeps the outbox into Convex. |

### Sync event shape

```json
{
  "deviceId": "dev-…",
  "events": [
    {
      "eventId": "0192…(uuidv7)",
      "deviceId": "dev-…",
      "seq": 12,
      "type": "stop.deliver",
      "occurredAt": "2025-12-23T01:14:00.000Z",
      "atMin": 404,
      "tripId": "…",
      "stopId": "…",
      "baseVersion": 1,
      "payload": { "unitsHanded": 15, "recipientName": "Kamal Silva", "signatureKey": "signature/…png", "chilledOk": true }
    }
  ]
}
```

`atMin` is the business-clock minute when the driver acted, so recorded times survive hours of dead zone. `baseVersion` is the stop version the phone had. If the server's version is higher, the fact is still applied and a conflict opens for DG-02.

## Server actions by screen

| Screen | Actions |
|---|---|
| D-01 tower, D-03 board | `autoPlanAction`, `moveOrderAction` (re-validated against rules 1–7 before saving) |
| D-04 deferrals | `decideDeferralAction` (keep deferred with a reason, or swap with another order) |
| D-05 publish | `publishAction` (pre-publish checks, then notifications to loaders, drivers and stores) |
| D-06 live ops | `decideShortfallAction` (HOLD / SEND_AND_WARN), `warnStoreAction`, `warnTripStoresAction`, `deferStopAction`, `messageDriverAction`, `replyStoreAction`, `closeExceptionAction`, `markHandledAction` |
| DG-02 reconciliation | `resolveConflictAction` (deliver today / keep next run / accept as recorded) |
| D-07 forecast | `uploadForecastAction` (Task 2A CSV), `clearForecastAction` |
| Fleet, People | `vehicleStatusAction`; `assignAction`, `rejectAction`, `setDisabledAction` |
| L-01 to L-04 dock | `markLoadedAction`, `flagShortfallAction`, `unitsFoundAction`, `signOffAction` |
| DR / DG-01 driver | `canDeliverAction`, `ackDriverNoticeAction` (everything else goes through `/api/sync`) |
| SM-01 to SM-05 store | `placeOrdersAction`, `confirmReceiptAction`, `messageDispatcherAction`, `ackNoticeAction` |
| Judge demo panel | `setClockAction`, `simulateAction`, `driveVehicleAction`, `storeOutletAction`, `resetDemoAction` |

## Realtime (Convex)

| Function | Kind | Caller |
|---|---|---|
| `signals.versions({ channels })` | query | browsers (subscribed through the Convex client) |
| `signals.relay({ secret, items })` | mutation | the Next.js outbox relay only (shared secret) |

Channels are `ops`, `orders`, `depot:{id}`, `trip:{uuid}`, `outlet:{id}`, `user:{uuid}` and `role:{role}`.
