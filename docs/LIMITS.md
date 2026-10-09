# Published limits (tested)

These limits are enforced in code and checked by `tests/limits.test.ts`. Anything above them is rejected with a clear message, not silently cut off.

| Area | Limit | Where |
|---|---|---|
| Lines per event | 500 | `MAX_LINES` (events/service.ts) |
| Lines per item import file | 200 | events/sheet.ts |
| Lots per event | 50 | `MAX_LOTS` (lots/service.ts) |
| Evaluation assumptions per event | 10 | commercial/assumptions.ts |
| File upload size | 4 MB | `MAX_BYTES` (files/service.ts) |
| Files per supplier bid | 24 | `MAX_BID_FILES` |
| Catalogue import | 1,000 items per file | `MAX_CATALOG_IMPORT` |
| Supplier import | 500 per file | `MAX_SUPPLIER_IMPORT` |
| Template workbook rows | 400 per sheet | `MAX_SHEET_ROWS` |
| Custom template size | 200,000 characters | templates/custom.ts |
| Quote validity | 1 to 730 days | journey/service.ts |
| Debrief feedback | 10 to 2,000 characters | journey/service.ts |
| Import file size (items) | 2 MB | events actions |

Not yet load tested: concurrent bidders at closing time, and events above 500 lines. Larger uploads need object storage (see the plan, R3).
