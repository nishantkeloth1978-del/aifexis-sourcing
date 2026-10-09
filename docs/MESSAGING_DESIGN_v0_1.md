# Aifexis Sourcing: event messaging design (v0.1)

Date: 10 October 2026. Status: design for review, nothing built yet.

## 1. What exists today

Each event has a Q and A: a supplier asks a private question, the buyer answers either to that supplier only or to everyone. Names are hidden from other suppliers. That is one-way: the supplier cannot reply, the buyer cannot start a conversation, there are no attachments, no read status, no question deadline, and nothing ties a question to the line it is about.

## 2. What the market does (evidence and limits)

Verified from public pages:

| Tool | What I could confirm |
|---|---|
| Workday Strategic Sourcing | A message centre per event "to replace email". Suppliers ask; the manager answers one supplier or shares to all with the asker's identity hidden and the question editable. Attachments on answers. A question deadline set at event build; after it, suppliers cannot ask, and changing it on a closed event needs support. Stakeholder answers can require owner approval. Staff emails are sent only twice a day. |
| Coupa Sourcing | A "Messages" box in the supplier screen to message the buyer. The training material says nothing on attachments, alerts or response times. |
| SAP Ariba | A message board per event; suppliers can view, send and reply. Public pages are summaries only, so I cannot confirm attachment, visibility or notification behaviour. |
| Public-sector guidance (Scottish Government, Tacto) | Questions and answers must be anonymised and go to all bidders at the same time; publish a question deadline and an answer date; answer no later than a fixed number of days before closing, otherwise extend the deadline; keep a full record of all communication. Sharing information with one bidder is a compliance risk. |

I could not find reliable review text on messaging for Ariba, Coupa, Jaggaer or Ivalua. The flaws below are therefore partly confirmed (Workday limits, public-sector rules) and partly hypotheses from how these products are built. Please test them with two or three buyers before we treat them as fact.

## 3. Flaws to design out

| # | Flaw (confirmed or hypothesis) | Our answer |
|---|---|---|
| 1 | Messaging is a separate inbox, away from what the question is about (hypothesis) | Questions attach to a line, requirement or document and show next to it on the bid form |
| 2 | One channel for everything, so a buyer can leak a clarification to a single bidder (compliance rule above) | Three lanes with different rules, and a guard that stops substantive answers going to one supplier only |
| 3 | Delayed or email-only alerts (Workday staff: twice daily) | Instant in-app badge and email, with reply-by-email so suppliers never need to log in to answer |
| 4 | Question deadline fixed by admin, no link to the closing date (Workday) | Deadline and "last answer date" are event settings; late answers extend the closing time after a buyer decision |
| 5 | Answers that change scope are not tied to an amendment (hypothesis) | "Answer changes scope" turns the answer into an amendment and notifies everyone |
| 6 | Anonymising is manual (Workday: buyer edits the question) | Automatic redaction of names, emails, phone numbers and attachment metadata, with a preview |
| 7 | Duplicate questions answered many times | Duplicate detection: answer once, link the rest |
| 8 | No ownership or response time (hypothesis) | Questions are assigned to a person with a due time; overdue ones show on the buyer's task list |
| 9 | Clarifying a submitted bid happens by email, outside the record (hypothesis) | A formal "bid clarification request" after closing, with a response deadline, kept in the audit record |
| 10 | Evaluators can be influenced by who is asking (hypothesis) | Evaluators see only the shared board, never private threads, and supplier names stay masked when anonymous evaluation is on |
| 11 | English-only, no Arabic (our context) | Arabic and English with RTL, and "show original" next to any machine translation |
| 12 | Hard to prove who knew what, and when | Tamper-evident log, read and acknowledgement receipts, included in the award dossier |

## 4. Design

### 4.1 Three lanes in one Messages tab

| Lane | Who sees it | Used for | Rules |
|---|---|---|---|
| **Q and A board** | All invited suppliers (anonymised) and the buyer team | Anything about the requirement, scope, dates, rules | Answers are published to all at once. Closes at the question deadline. |
| **Private thread** (one per supplier) | That supplier and the buyer team only | Matters that concern only that bidder: access problems, upload trouble, their own bid, confidential commercial points | Conversational, with attachments. Cannot be used to give one bidder new requirement information (see 4.3). |
| **Notices** | All suppliers, one-way | Reminders, amendments, closing changes, clarification-meeting details | Buyer sees who has opened and acknowledged each one. Suppliers cannot reply, they ask on the board. |

Suppliers cannot message each other. After closing, only the buyer can start a message, as a bid clarification request in that supplier's private thread.

### 4.2 Event phases

| Phase | Board | Private thread | Notices |
|---|---|---|---|
| Draft | none | none | none |
| Open for bids | suppliers ask until the question deadline; buyer answers until the last answer date | either side can write | yes |
| Closed to award | locked | buyer-started clarification requests only, response deadline required | yes |
| Awarded | locked | debrief thread, released by the buyer | yes |
| Cancelled | locked | read-only | the cancellation notice |

### 4.3 The equal-treatment guard

When a buyer replies in a private thread, the system checks whether the reply looks like it clarifies the requirement (new quantities, specifications, dates, scope). If so, the buyer sees: "This looks like it affects all bidders. Share it on the board?" with the anonymised text ready to publish. The buyer can say no and give a reason; the reason is stored and shown to the approver and the auditor. A weekly "private replies that may need sharing" list goes to the event owner. The check only advises; it never blocks, because a wrong block in a tender is worse than a prompt.

A supplier can mark a question confidential with a reason. The buyer can reclassify it to the board; the supplier is told and can withdraw it instead.

### 4.4 Buyer-side workflow

- Each question has a status: new, assigned, drafted, awaiting approval, published, closed.
- Assign to a colleague (technical or commercial expert) with a due time; the event owner can require approval before publishing.
- AI drafts an answer from the event documents and earlier answers, marked as a suggestion; the buyer edits and publishes. Nothing is sent by AI alone.
- Internal notes on any question, never visible to suppliers.
- Merge duplicates: one answer, all askers notified.
- "Answer changes scope" starts an amendment from the answer.

### 4.5 Supplier-side experience

- A speech icon beside each line and requirement opens the question box already linked to it; the board also lists all questions in one place.
- Immediate in-app badge and email; reply to the email and it lands in the thread (signed address, quoted text stripped, attachments scanned).
- Question deadline and answer date shown with the same clock used for closing time.
- Unread count on the event card; "answered" and "still open" clearly separated.
- Arabic and English; any translated message shows the original underneath.

### 4.6 Controls and records

- Attachments follow the existing file rules (type and size limits, malware scanning when that backlog item ships).
- Every message is stored once, never edited in place; corrections are new entries linked to the original. Each entry carries a hash of the previous one so the log is tamper-evident.
- Read receipts per message and acknowledgement per notice.
- Contact-detail warning when a supplier types a phone number or email into a board question.
- Rate limits and length limits on suppliers.
- Included in the award dossier and the CSV export; retention follows the event.

### 4.7 Permissions

| Role | Board | Private threads | Notices | Internal notes |
|---|---|---|---|---|
| Buyer, event owner | read, answer, publish | read, write all | send | read, write |
| Other buyer-team members | read, answer if assigned | read; write if assigned | read | read, write |
| Evaluators | read | none | read | none |
| Approvers, auditor | read | read (auditor only, logged) | read | auditor read |
| Supplier | read, ask | own thread only | read, acknowledge | none |

## 5. Data model (proposal)

- `message_thread`: event, lane (board, private, notice), supplier (private only), anchor (line, requirement or document), status, assignee, due time, confidential flag and reason, merged-into.
- `message`: thread, author type and id, body, language, internal flag, hash, previous hash, created time. Never updated.
- `message_attachment`: message, stored file reference.
- `message_receipt`: message, reader, read time, acknowledged time.
- `board_publication`: source question, anonymised question text, published answer, publisher, published time, scope-change flag, linked amendment.
- Existing `clarification` rows migrate into board threads so no history is lost.

All tables follow the existing tenant isolation and forced row-level security.

## 6. Release plan

| Release | Contents |
|---|---|
| M1 | Private threads with attachments, notices with acknowledgement, in-app badges, immediate emails, phase rules, audit, tests |
| M2 | Board with automatic anonymising and preview, question and answer deadlines, assignment, approval, duplicate merge, equal-treatment guard, anchoring to lines, bid clarification requests |
| M3 | Reply by email, AI draft answers, translation with original, response-time report, scope-change to amendment |

## 7. Decisions for you

1. Should evaluators be able to read the board (my default) or nothing at all?
2. Do you want reply-by-email in the first release? It removes the biggest supplier friction but adds an inbound-email setup.
3. Real-time updates: polling every 15 seconds fits Vercel today; Supabase Realtime is smoother but another moving part. I recommend polling first.
4. Should a late answer extend the closing time automatically, or only after the buyer confirms? I recommend after the buyer confirms.
5. Is WhatsApp or SMS alerting in scope for suppliers in the region, or email only?

## 8. Sources

- Workday: [Strategic Sourcing event communications](https://doc.workday.com/admin-guide/en-us/spend-management/strategic-sourcing/events/communications/xlz1595977159243.html)
- Coupa: [supplier training material, University of Texas Health](https://www.uth.edu/buy/documents/Sourcing_Supplier_Training%20Rev10.1.20.pdf)
- SAP Ariba: [Event Messages function (summary page)](https://support.ariba.com/Item/view/216713)
- Scottish Government: [Procurement Journey, questions and answers](https://www.procurementjourney.scot/node/306)
- Tacto: [bidder communication](https://www.tacto.ai/en/procurement-glossary/bidder-communication)
