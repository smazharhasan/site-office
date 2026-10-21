# Mimaar for ERPNext

Construction procurement, site store, supplier accounts and site management for a
house or building project, on top of standard ERPNext v16.

Built for the Villa 31 house project by SMH Global Services.

## What it adds to ERPNext

- **Suppliers from their quotation**: scan a quotation, proposal or WhatsApp/e-mail
  screenshot; AI (Gemini or Claude) reads the supplier and every line, printed or
  handwritten, English or Urdu, and registers a new supplier from it.
- **Quotation revisions and a locked final**: a confirmed (submitted) quotation can't
  change; a change is a new revision (Cancel → Amend) with a note of what changed. The
  agreed one is locked as final and can't be revised again.
- **Purchase orders only from the final quotation**, never above the quoted rate.
  Drafts can change (every version kept in the history); once submitted the order is
  locked: it can't be cancelled or revised, and only then can it be printed or sent.
- **Send by PDF, WhatsApp or e-mail**: purchase orders, RFQs (to each supplier) and
  supplier statements, through a time-limited PDF link.
- **Receiving at site** only against a purchase order, with the supplier's delivery
  note number, its scan (AI fills in the quantities) and the receiver's photo.
  Partial deliveries keep the order open.
- **Invoices** scanned against the goods received; **payments** only against invoices
  that are due, or as an advance on a purchase order whose terms include one (never
  more than that advance), always with a proof of payment.
- **Supplier account statement** (report, PDF, WhatsApp, e-mail) and a **procurement
  trace** from quotation to payment for any item or document number.
- **Site diary, inspections with a corrective action plan, and snags.**
- **Labour**: worker register (CNIC, society entry card, police verification, daily
  wage), printed site cards with a QR code, daily attendance by scanning the cards
  (the registered face is shown to compare), with the team photo and the phone's
  location, and a days-worked-and-wages report per contractor.
- **Urdu**, written right to left.

## Install

```
bench get-app https://github.com/smazharhasan/site-office --branch erpnext-app
bench --site <site> install-app mimaar
```

On Frappe Cloud: add the app from GitHub to your bench group, deploy, then install it on
the site. See `docs/frappe-cloud.md`.

## Users

Four role profiles are added (and a Site Supervisor role); pick one on each user (User → Roles → Role Profiles):
**Mimaar Owner**, **Mimaar Site Supervisor**, **Mimaar Store Keeper**, **Mimaar Accountant**.
Each user chooses English or Urdu under My Settings → Language.

## Bringing data across from the old Mimaar app

The project data is not kept in this public code. Open **Mimaar Settings**, click
**Bring data from the old Mimaar app** and choose the exported file (`mimaar-data.json`):
the item catalogue, budget, master schedule, suppliers and agreed payment plans are added.
Safe to repeat.

## AI scanning

Open **Mimaar Settings**, choose Gemini or Claude and paste your own API key there. It is
kept encrypted on the server and never shown again in the browser.

## Licence

MIT
