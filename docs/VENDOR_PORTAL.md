# Vendor portal

**Invite when you publish.** On a draft event, the *Suppliers to invite* card lets the buyer pick suppliers one by one or a whole category. When the event is published (by the approver, or automatically below the approval threshold) every chosen supplier gets an invitation and an e-mail with its link. After publication the invitation list still allows single invitations, and *Get invitation links for everyone not yet signed up* makes fresh links to send by hand (old links stop working).

**Accept or decline.** In the supplier portal each open event shows *Will you take part?*. Accepting confirms participation; declining needs a short reason, stops bidding and tells the buyer. A supplier can change their mind while the event is open, but cannot decline after submitting a bid. The buyer sees Will take part / Declined (with the reason) in the invitation list.

**Vendor registration.** Suppliers page, *Vendor registration*: switch it on and share the link (`/vendors/register/<key>`). Applications wait for an administrator (or anyone who may manage suppliers) to approve or reject; approval creates the supplier with its profile and contact user, so it can be picked for events. The applicant is e-mailed. A new link replaces the old one; switching off closes it. Applications are limited per address and per hour, with a hidden field against bots.

**E-mail.** Set these in Vercel (Settings, Environment Variables), then redeploy:
- `RESEND_API_KEY` and `MAIL_FROM` (a verified sender in Resend): turns real sending on. Until then e-mails are queued and only logged.
- `APP_URL`, for example `https://sourcing.aifexis.com`: the address written into invitation links and e-mails.
Queued e-mails go out on the next automatic run (every few minutes where the worker or scheduler runs).

Migration: `0069_vendor_portal.sql` (event_supplier_plan, invitation response columns, vendor_registration, supplier_application, and two public functions). Run `0068_app_user_policy.sql` first if you have not.
