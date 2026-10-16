# Testing Aifexis with a local ERPNext

The bridge (`scripts/erpnext-bridge.ts`) runs on your own computer and only makes outgoing calls, so ERPNext (for example http://127.0.0.1:18080) never has to be reachable from the internet.

Flow: ERPNext **Material Request** (type Purchase, submitted) -> Aifexis **request** -> you run the event in Aifexis (draft, publish, bids, recommend, award) -> **draft Purchase Order** in ERPNext, linked to the Material Request. A person submits the Purchase Order in ERPNext.

## One-time setup
1. **ERPNext API keys.** User list > open the user > API Access > Generate Keys. The secret is shown once. Keep both for the hidden prompts; never paste them in chat or into files.
2. **ERPNext master data.** Create the Items you will request (item code, for example SEAL-01) and a Supplier for each test bidder. Note each Supplier's ID (for example SUP-0001), not just its name.
3. **Aifexis connection.** Configuration > Connected systems > Create connection. Tick all three: send requests, read the state of requests, read awards. Also tick **Create a draft event as soon as a request arrives** so a requirement from ERPNext becomes an event with no manual step (the event is a draft and still needs the normal publication approval). Copy the key (shown once).
4. **Aifexis supplier records.** Put the ERPNext Supplier ID in the supplier's vendor number. (If it is empty the bridge falls back to an exact match on the supplier name.)

## Each test
1. In ERPNext create a Material Request, type **Purchase**, with items and quantities, and **Submit** it.
2. `npx tsx scripts/erpnext-bridge.ts push --dry` shows what would be sent; run without `--dry` to send. Each item arrives as a line like `[SEAL-01] Seal kit`.
   **Keep the `[CODE]` at the start of each line description** when you edit the request, draft or event. The bridge reads the ERPNext item code from it.
3. In Aifexis: the event already exists as a draft (raised by the administrator who owns the connection; reassign the buyer if needed). Check the lines, approve and publish, let your test suppliers bid, evaluate, recommend and approve the award.
4. `npx tsx scripts/erpnext-bridge.ts pull --dry`, then without `--dry`. It creates one **draft** Purchase Order per winning supplier. Running it again does nothing (it checks Order Confirmation No `<event ref>-<vendor number>`).
5. Open the Purchase Order in ERPNext, check items, quantities and rates against the award, then submit it.

`run` does push and pull in one go. `watch` repeats it every 60 seconds (`--every 30` to change) until you press Ctrl+C, so a new Material Request becomes an event, and an approved award becomes a draft Purchase Order, without running anything by hand.

## Messages
- `wait ... no event yet` / `not awarded yet`: nothing to bring back yet.
- `no ERPNext Supplier matches`: fix the vendor number on the supplier record.
- `no ERPNext item code`: the `[CODE]` prefix was removed from a line description.
- `ERPNext 4xx ...` on creating the order: the message from ERPNext is shown (typically a missing warehouse, an item that is not purchasable, or a currency that does not match the company or supplier).

## Limits of this test
Requests are pulled by polling (run the script again), not pushed. Lines carry the item code only inside the description. Currency comes from the prompt, not from ERPNext. Purchase Orders are always created as drafts.
