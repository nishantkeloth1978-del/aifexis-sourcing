# Purchase / service requests (Phase 2)

Anyone with `request.create` (all members by default) raises a request at **Requests → New request**.
Reference `REQ-YYYY-NNNN`. Fields: kind (goods/service), title, description, owner department, needed-by, estimated value + currency, up to 50 lines.

Flow: new -> converted (draft event created) | rejected (note >= 5 chars) | withdrawn (by requester, while new).
Buyers (users with `event.create`, or admins) are notified on creation. Duplicate guard: same requester + title within 24 h.
Converting runs in one transaction: draft event with `request_id`, requester added as event role `requester`, converting buyer as `buyer`, lines copied to event items; requester is notified.
Visibility: requesters see their own; `event.create` holders see all.

Not yet: category/template selection, external intake (API/file/email) - Phase 3.
Migration: 0058_purchase_request.sql
