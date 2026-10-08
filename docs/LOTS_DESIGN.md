# Lots and split awards: design

Goal: one event can be split into lots. Suppliers price the lots they want. Each lot is ranked and awarded on its own, so one event can end with several winning suppliers. An event without lots behaves exactly as before.

## Rules
1. Lots are optional. If an event has any lot, every item must belong to a lot and every lot must have an item. Checked when the event is submitted for publication.
2. Lots and the lot of each item can change only while the event is a draft (same rule as items).
3. A supplier prices a whole lot or none of it. A lot with some prices and some blanks is refused. At least one lot must be priced. Lots left blank are "no bid" for that lot.
4. Technical evaluation stays at event level: one score and one qualified or not qualified result per supplier. Mandatory declarations (gates) are event level too.
5. Commercial ranking is per lot: only qualified suppliers who priced that lot. Commercial score = lowest bid in the lot / this bid x 100. Final = technical weight x technical + commercial weight x commercial. The close-result warning is per lot.
6. The recommendation picks one supplier per lot that has bids (the reason text is shared). A lot with no qualified bids stays unawarded. At least one lot must be awarded.
7. Award approval stays one decision on the whole recommendation. Approval thresholds use the event's estimated value.
8. "Current recommendation" = the rows saved together by the latest recommendation action. A send-back followed by a new recommendation replaces the whole set.
9. Handover is one document per winning supplier (a supplier who wins lots 1 and 3 gets one document with both lots). Each supplier is sent and recorded separately, once per target.
10. The awards report sums the awarded lots. A saving against the estimate is shown only when every lot was awarded.

## Data
- `event_lot (tenant_id, id, event_id, lot_no, name)`; `event_item.lot_id` (nullable); `recommendation.lot_id` (nullable); `handover_log.supplier_id` (nullable).
- Bid payload `price_lines` gets `lots: [{lotId, lotNo, total}]` and each line carries `lotId, lotNo`. `total` stays the sum of the priced lots.
- Commercial comparison gets `lots: [{lotId, lotNo, name, rows, lines, closeResult}]`. For events with lots the top-level `rows` and `lines` are empty.

## Where it touches
Event editing and import (Lot column), duplicate and templates, supplier bid form and price sheet, commercial view and recommendation, award pack, comparison export, handover, awards report, Arabic messages.
