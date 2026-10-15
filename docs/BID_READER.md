# Bid check and bid reader (Phase 5)

**Where:** event page → **Check the bids** (buyer of the event, or someone who can act for the buyer), once the event has closed and at least one envelope is open. The page reads only what the buyer is already allowed to see (the same sealed-envelope rules as evaluation); with nothing open it says there is nothing to check. Supplier names follow the blind-evaluation setting.

**Fixed rules (no AI, always run)** over stored bid data: a line with no price or declined; prices in a currency other than the event's (blocking); a mandatory declaration answered No; a unit price more than 50% below or more than double the median of the other bids (needs at least two other bids; exact decimal arithmetic).

**Bid reader (needs the company Claude key; counts against the daily AI cap):** reads each bid's technical response and questionnaire answers against the event's lines and lists exclusions, deviations, conditions, alternatives, unaddressed requirements and unclear points, plus terms the supplier states (incoterm, payment terms, validity, delivery days, warranty). Each finding must carry an exact quote from the supplier's text and a real line number, and terms must appear in the text; anything else is dropped before it is stored (the model's claims are traced to the source). The supplier's text is passed as data with an explicit instruction to ignore instructions in it; an attempt to steer it can only appear as an "unclear" finding. Every call is stored in `agent_run`.

**Acting on findings:** the buyer ticks the points for one supplier and chooses **Ask the supplier**. One private message is sent with a reply deadline (1 to 30 days), written from fixed sentences per finding kind that quote only the supplier's own words; nothing the model wrote is ever sent. Findings can be dismissed; handled findings are not reopened by a re-run. Everything is audited (`bidcheck.run`, `bidcheck.clarification_requested`, `bidcheck.dismissed`).

**Accuracy check inside the app:** Configuration → Bid reader accuracy → Run the accuracy check (administrators with the configuration permission; three runs an hour; ten short model calls with the company key; writes only an audit entry).

**Not sent automatically.** The plan's auto-clarification stays off: it is to be switched on only after the reader reaches an agreed accuracy on the labelled set. Run the check yourself with your key:
`npx tsx scripts/eval-reader.ts` (it asks for the tenant id, the database connection string and the signing secret; the last two are hidden while you type and are never saved). It scores the 10 labelled cases in `src/agents/reader-cases.ts` (precision, recall, F1, misses and extras). Add real, anonymised bid texts to the file as you collect them.

**Not yet:** attached quotes (PDF, Excel, Word) are not read (needs a text extractor and its own scan/limits); the reader sees the technical response and questionnaire answers only; no per-line price extraction from free text (prices come from the structured form).

Migration: 0061_bid_check.sql
