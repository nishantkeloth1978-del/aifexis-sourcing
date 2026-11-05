# Opening sealed envelopes

Set in **Configuration → Opening of envelopes** (administrators). Applies to events published from then on; an event keeps the way it was published with. Events published before this setting existed stay **witnessed**.

| Setting | Choices |
|---|---|
| Default way to open | **Witnessed** (a different person confirms, as before), **Buyer alone** (the buyer opens; the audit log records who and when), **Automatic** (the system opens by itself when bidding closes, and again when the technical result is approved) |
| Envelopes | **Two**: technical first, prices after the technical result is approved. **One**: technical and price open together; every bidder who did not fail a disqualifying declaration goes forward and price decides |
| Rules by event value | Up to 4 rules: from this value (AED) upwards, use this way to open instead of the default. An event with no value gets the strictest way configured |

Notes
- Automatic opening does nothing when no bids were received; the event stays closed for a person to handle. Autopilot events keep Autopilot's own flow.
- Every opening records its mode (`opening_record.opened_mode`) and the audit entry shows `opening_mode` and whether it was witnessed.
- Run `0070_envelope_opening.sql` first (opening by the system has no person, so `opened_by` may be empty).
- Control stays strict by default: nothing changes until an administrator changes the setting.
