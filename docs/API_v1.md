# Aifexis integration API v1

Base: `https://<your-site>/api/v1`. JSON in and out. Errors: `{"error":{"code","message"}}`.

## Keys
Configuration → Connected systems → Create connection. The key (`aifx_<12 hex>_<43 chars>`) and the webhook signing secret are shown **once**. Only a hash of the key is stored; the secret is encrypted. Revoke and recreate to rotate.
Send `Authorization: Bearer <key>`. Scopes: `requests:write`, `requests:read`, `awards:read`. Limits: 120 calls per minute per key, body 64 KB, bad keys limited per address.
Requests are recorded as raised by the administrator who created the connection (source `api`).

## POST /requests  (requests:write)
Headers: `Idempotency-Key: <1-100 chars>` (recommended).
```json
{ "kind": "goods|service", "title": "Pump spares", "description": "", "department": "Maintenance",
  "neededBy": "2026-12-01", "estimatedValue": "5000", "currency": "AED", "externalReference": "ERP-1001",
  "lines": [ { "description": "Seal kit", "quantity": "10", "unit": "EA" } ] }
```
201 `{id, reference, externalReference, state, createdAt, duplicate:false}`. A repeat of the same Idempotency-Key, or of the same `externalReference`, returns 200 with the first result and `duplicate:true`. A validation failure is 422 and the key can be used again after fixing it. Same rules as the screen. Buyers are notified.

## GET /requests/{reference or externalReference}  (requests:read)
`{id, reference, externalReference, state: new|converted|rejected|withdrawn, eventReference, decisionNote}`. Only requests created through the API.

## GET /events/{eventReference}/award  (awards:read)
409 until the event is awarded. Then `{eventReference, requestReference, externalReference, awards:[...]}` with one `aifexis.award.v1` document per winning supplier (vendor, optional lots, items with quantity/unit/unitPrice/netAmount, totalNet, awardedAt).

## Webhooks
Optional per connection, https only, public hosts only (private addresses are refused when saved and again when sending; redirects are not followed).
Events: `request.accepted`, `request.rejected`, `event.published`, `event.closed`, `award.approved`.
Body: `{ "type", "createdAt", "data": { eventRef, requestRef, externalRef, title, state, ... } }`; `award.approved` carries `awardUrl` to fetch the full award.
Headers: `X-Aifexis-Event`, `X-Aifexis-Delivery`, `X-Aifexis-Timestamp` (unix seconds), `X-Aifexis-Signature: v1=<hex>` where hex = HMAC-SHA256(secret, `${timestamp}.${rawBody}`). Reject timestamps older than 5 minutes.
Any 2xx is success. Otherwise retried after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then marked failed. Configuration shows the log; **Send again** replays a failed delivery. Deliveries are at-least-once: dedupe on `X-Aifexis-Delivery`.
Retries run on the automation clock (worker, daily cron, page-view backup), so without the worker, delays can be longer than the schedule above.

## File import / export
Requests → Import from CSV (template download; columns external_ref, kind, title, description, department, needed_by, est_value, currency, line_description, line_quantity, line_unit; rows with the same external_ref form one request; max 200 rows, 200 KB; row-by-row result; re-importing skips known external refs). Requests → Export CSV.

## SAP purchase order format
`GET /api/v1/events/{ref}/award?format=sap-po` (scope `awards:read`) returns `purchaseOrders`: for each winning supplier either `{supplier, purchaseOrder, warnings}` (S/4HANA purchase order field names: header with `PurchaseOrderType`, `CompanyCode`, `PurchasingOrganization`, `PurchasingGroup`, `Supplier`, `DocumentCurrency`, `PurchaseOrderDate`, `CorrespncExternalReference`, and `to_PurchaseOrderItem[]`) or `{supplier, errors}` when something is missing. The organisation codes and unit map come from Configuration, "SAP purchase order mapping".

## Ariba purchase order format
`GET /api/v1/events/{ref}/award?format=ariba-cxml` (scope `awards:read`) returns `orders`: for each winning supplier either `{supplier, orderId, cxml, warnings}` (a cXML 1.2 OrderRequest as text) or `{supplier, errors}`. The buyer identity and unit map come from Configuration, "Ariba purchase order mapping".

## Automatic event creation
A connection can be created with "Create a draft event as soon as a request arrives". Then `POST /requests` also converts the request at once, as the connection's owner: the response has `state: "converted"` and `eventReference`. The event is a draft; publication approval is unchanged. Not available for connections without `requests:write`.
