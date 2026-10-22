# Mimaar on Frappe Cloud: setting it up

About an hour, mostly waiting. No programming. You need:

- a debit or credit card that works for international payments (Frappe Cloud bills in US dollars);
- your GitHub sign-in (the account that holds `site-office`);
- the data file `mimaar-data.json` (sent to you in the chat);
- your Gemini API key, if you want AI scanning (from https://aistudio.google.com/apikey).

## 1. Create the Frappe Cloud account

1. Go to https://frappecloud.com and sign up with your e-mail or Google account.
2. Open **Billing** and add the card.

## 2. Create a private bench group

Mimaar is a custom app, and Frappe Cloud only runs custom apps on a *private bench group*.

1. In the dashboard open **Bench Groups** and click **New**.
2. Version: **Version 16**. Region: the one nearest to Pakistan (Mumbai is usually closest).
3. Apps: **Frappe Framework** and **ERPNext** (both version 16).
4. Name it `mimaar` and create it.

## 3. Add the Mimaar app

1. In the bench group open the **Apps** tab, click **Add App**, then **Add from GitHub**.
2. Click **Connect To GitHub**, sign in, and allow Frappe Cloud to see the `site-office` repository.
3. Choose **smazharhasan → site-office**, branch **erpnext-app**.
4. Click **Validate App**, then **Add app**.
5. Click **Show updates**, then **Deploy**. Wait until the deploy shows **Success**
   (15–30 minutes).

## 4. Create the site

1. In the bench group open **Sites** and click **New Site**.
2. Name: `villa31` (the address becomes `villa31.frappe.cloud`).
3. Plan: one that includes a **private bench** (from about US$25 a month on the cheapest
   such plan; see https://frappe.io/cloud/sites, some regions are cheaper).
4. Apps: tick **ERPNext** and **Mimaar**. Create, and wait about 5 minutes.

## 5. First sign-in (setup wizard)

Open the site and sign in as Administrator (the dashboard has a **Login as Administrator**
button). Answer the questions:

- Language **English** (each person can switch to Urdu later), country **Pakistan**,
  time zone **Asia/Karachi**, currency **PKR**.
- Your name, e-mail and a strong password. **This is the owner's sign-in.**
- Company **Villa 31**, abbreviation **V31**, chart of accounts **Standard**,
  financial year **01-07-2026 to 30-06-2027**.

Mimaar's rules switch on by themselves when the wizard finishes.

## 6. Bring the data across

1. In the search bar type **Mimaar Settings** and open it.
2. Click **Bring data from the old Mimaar app** and choose `mimaar-data.json`.
3. After a minute or two a message lists what was added: items, budget lines, the
   15-milestone schedule, suppliers and the agreed payment plans.

The payment plans arrive as **draft supplier quotations**. Open each one, check it, submit
it and click **Lock as final**; purchase orders are raised from there.

## 7. Turn on AI scanning

In **Mimaar Settings**: AI provider **Gemini** (or Claude), paste your API key, **Save**.
The key is stored encrypted on the server and is never shown again.

## 8. Add the people

For each person: search **User → New**, enter the e-mail and name, save, then in
**Roles & Permissions → Role Profiles** add one of:

| Profile | For | Can |
| --- | --- | --- |
| Mimaar Owner | you, a partner | everything |
| Mimaar Site Supervisor | site engineer / supervisor | suppliers, quotations, orders, receiving, store, workers, attendance, diary, inspections |
| Mimaar Store Keeper | store keeper | receive goods, release to work, diary, inspections |
| Mimaar Accountant | accountant | supplier bills, payments, statements |

Under **Settings → Language** pick **ur** for anyone who prefers Urdu (written right to
left). Each person gets an e-mail to set their password.

## 9. Phones

The two versions are separate Android apps that sit side by side; both are on
https://github.com/smazharhasan/site-office/releases/latest

- **Mimaar.apk**: the current Mimaar app, unchanged.
- **Mimaar-ERP.apk** (blue icon): opens Mimaar ERP. The first time it asks for the site
  address: type `villa31.frappe.cloud` and press **Open**, sign in, and allow the camera
  and location.

## 9a. On the laptop

Mimaar ERP also runs on a Mac with Docker Desktop: the "Mimaar ERP" folder on the Desktop
has Install / Start / Stop / Update / Back up buttons, and the site opens at
http://localhost:8081. It uses the image `ghcr.io/smazharhasan/mimaar-erpnext:16`, built
from this branch by GitHub Actions.

## 10. E-mail

Frappe Cloud sites can send e-mail without any set-up. To send from your own address
instead, add it under **Email Account** (for Gmail, use an app password).

## Everyday use

| To do this | Go to |
| --- | --- |
| Register a supplier from their quotation | Suppliers → **New supplier from their quotation** |
| Record a quotation | Supplier quotations → **Scan a quotation**, check the lines, Save, **Submit** |
| Change a confirmed quotation | open it → **Cancel** → **Amend**, note what changed, Submit |
| Agree a quotation | open it → **Lock as final** |
| Raise a purchase order | final quotation → **Create → Purchase Order**, Save (editable), **Submit** (locked) |
| Send a purchase order | purchase order → **Send** → PDF, WhatsApp or e-mail |
| Pay an advance | purchase order → **Create → Advance payment**, attach the proof, Submit |
| Receive goods | purchase order → **Create → Purchase Receipt** → **Scan delivery note**, receiver's photo, Submit |
| Record the bill | purchase receipt → **Create → Purchase Invoice** → **Scan bill**, Submit |
| Pay a bill | purchase invoice → **Create → Payment**, attach the proof, Submit |
| Supplier ledger | supplier → **Account statement** (PDF, WhatsApp, e-mail) |
| Follow one purchase end to end | **Procurement trace** |
| Release material to work | **Release to work** (Stock Entry, Material Issue), name who took it |
| Register a worker, print the site card | **Workers and site cards** → New → **Print site card** |
| Mark attendance | **Attendance** → New → **Scan site cards**, team photo, Submit |
| Days worked and wages | **Days worked and wages** report |
| Schedule and Gantt | **Project** → Villa 31, **Schedule** |
| Budget against spending | **Budget vs actual** |
