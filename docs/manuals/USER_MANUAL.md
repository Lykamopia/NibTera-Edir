# NibTera Edir — User Manual

**For Edir members and everyday users**

---

<table>
<tr><td><b>Product</b></td><td>NibTera Edir — Edir Management Platform</td></tr>
<tr><td><b>Document</b></td><td>User Manual</td></tr>
<tr><td><b>Version</b></td><td>1.1</td></tr>
<tr><td><b>Audience</b></td><td>Edir members; payers using the NIB Super App; holders of a member login</td></tr>
<tr><td><b>Last updated</b></td><td>13 July 2026</td></tr>
<tr><td><b>Classification</b></td><td>Public / End-user</td></tr>
</table>

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Purpose](#2-purpose)
3. [Scope](#3-scope)
4. [Definitions, Acronyms, and Abbreviations](#4-definitions-acronyms-and-abbreviations)
5. [Getting Started](#5-getting-started)
   - 5.1. [System Requirements](#51-system-requirements)
   - 5.2. [Login and First-Time Setup](#52-login-and-first-time-setup)
   - 5.3. [Logout and Session Security](#53-logout-and-session-security)
6. [Accessing the System](#6-accessing-the-system)
   - 6.1. [Login and Authentication](#61-login-and-authentication)
   - 6.2. [First-Time Setup](#62-first-time-setup)
7. [System Utilities](#7-system-utilities)
   - 7.1. [Switching Language (English / አማርኛ)](#71-switching-language-english--አማርኛ)
   - 7.2. [Notifications](#72-notifications)
8. [Your Dashboard and Navigation](#8-your-dashboard-and-navigation)
9. [Paying Contributions through the NIB Super App](#9-paying-contributions-through-the-nib-super-app)
10. [Understanding Your Payment Screen](#10-understanding-your-payment-screen)
11. [Paying on Behalf of Another Member](#11-paying-on-behalf-of-another-member)
12. [Contribution Coverage, Penalties, and Installments](#12-contribution-coverage-penalties-and-installments)
13. [Payment History and Receipts](#13-payment-history-and-receipts)
14. [Self-Service Requests](#14-self-service-requests)
15. [Rules and Bylaws](#15-rules-and-bylaws)
16. [Managing Your Account and Security](#16-managing-your-account-and-security)
17. [FAQ & Troubleshooting](#17-faq--troubleshooting)
    - 17.1. [Common Issues](#171-common-issues)
    - 17.2. [Frequently Asked Questions](#172-frequently-asked-questions)
18. [Safety, Security, and Good Practice](#18-safety-security-and-good-practice)
19. [Support and Contacts](#19-support-and-contacts)
    - 19.1. [Technical Support](#191-technical-support)
    - 19.2. [Administrative Support](#192-administrative-support)

---

## 1. Introduction

**NibTera Edir** is a digital platform that modernizes how Ethiopian *Edir*
associations operate. As a member, it lets you:

- Pay your monthly contributions, arrears, and penalties directly from your phone
  through the **NIB Super App** — no cash, no queues.
- See exactly what you owe, what has been paid, and which months are covered.
- Review your full payment history and download receipts.
- Submit requests to your Edir (for example, adding a relative or reporting an
  emergency) and track their status.
- Read your Edir's official rules and bylaws.

Everything is secured to bank-grade standards, and every payment is confirmed in
real time.

---

## 2. Purpose

The purpose of this manual is to give Edir members a clear, practical guide to
using NibTera Edir for everyday tasks — chiefly paying contributions and, where a
login has been issued, using the member web portal. It explains each screen you
will encounter, the steps to complete common actions, and what to do when
something does not go as expected.

This document is written for **end users**. It does not cover administrative,
committee, or platform-configuration tasks, which are described in separate
administrator documentation.

---

## 3. Scope

This manual covers the two ways members interact with NibTera Edir. You may use
one or both:

| Channel | Who uses it | What you can do |
|---------|-------------|-----------------|
| **NIB Super App payment mini-app** | Every member with a NIB account | Look up your Edir obligations and pay securely. No separate password required — you are identified through your NIB Super App session. |
| **Member web portal (login)** | Members who have been given a login by their Edir | Sign in to view a personal dashboard, submit self-service requests, read rules, manage your profile, and change your password. |

> **Note.** Not every member has a web login — many members only ever use the
> payment mini-app, which is all that is needed to keep contributions current.
> Your Edir Administrator decides whether to issue you a login account.

**Out of scope.** This manual does not describe Edir administration, staff
approval workflows (maker–checker), platform setup, or the internal disbursement
process for emergency claims beyond what a member needs to know.

---

## 4. Definitions, Acronyms, and Abbreviations

### Key concepts at a glance

| Term | What it means for you |
|------|-----------------------|
| **Contribution / Monthly fee** | The regular amount every member pays to the Edir each month. |
| **Outstanding balance** | The total you currently owe (unpaid months + penalties + charges). |
| **Penalty** | An extra charge added when a payment is late, based on your Edir's rules. |
| **Grace period** | A number of days after the due date during which no penalty applies. |
| **Installment plan** | A schedule that lets large amounts (e.g. the registration fee) be paid in parts. |
| **Coverage / Paid through** | The latest month your contributions fully cover. Paying ahead extends this. |
| **Emergency benefit** | A payout your Edir provides for qualifying events such as bereavement or illness. |

### Glossary

| Term | Definition |
|------|------------|
| **Edir (እድር)** | A traditional Ethiopian mutual-aid association for members and their families. |
| **NIB Super App** | The National Investment Bank mobile app through which contributions are paid. |
| **Member ID** | Your unique identifier within your Edir (format: `EDR-YYYY-NNNN`). |
| **Outstanding balance** | The total amount you currently owe. |
| **Monthly fee / contribution** | The recurring monthly amount due to the Edir. |
| **Grace period** | Days after the due date before a penalty applies. |
| **Penalty** | An additional charge for late payment or missed obligations. |
| **Installment** | One scheduled part-payment of a larger amount. |
| **Coverage / Paid through** | The latest month your payments fully cover. |
| **Emergency benefit** | A payout for qualifying hardship events. |
| **Grievance** | A formal complaint or dispute you can raise with your Edir. |
| **2FA (Two-factor authentication)** | A second verification step at sign-in for extra security. |
| **Maker–checker** | The governance rule that sensitive actions require a second person's approval — this is why some requests take time to be finalized. |

---

## 5. Getting Started

### 5.1. System Requirements

To use NibTera Edir you need the following, depending on how you access it:

| To do this… | You need… |
|-------------|-----------|
| **Pay contributions** | The **NIB Super App** installed on your phone and be signed in to it. The payment page must be opened from inside the Super App to establish a secure session. |
| **Use the member web portal** | A current web browser (Chrome, Edge, Safari, or Firefox) on a phone or computer, plus a **login account** issued by your Edir. |
| **Be identified correctly** | Your phone number registered with the Edir must match the number tied to your NIB Super App account. |

No special hardware is required. An active internet connection is needed for both
channels.

### 5.2. Login and First-Time Setup

There are two entry points, and they behave differently:

- **NIB Super App (payment):** you do **not** log in separately. Opening the Edir
  payment service from inside the Super App establishes a secure, pre-authenticated
  session automatically. You are ready to pay immediately.
- **Member web portal:** if your Edir issued you a login, you sign in with an
  email (or phone) and password. The **first time** you sign in you will be
  required to set your own password. Full details are in
  [Section 6.2, First-Time Setup](#62-first-time-setup).

### 5.3. Logout and Session Security

Your sessions are protected automatically:

- **Web portal sessions expire** after **30 minutes of inactivity**, or **8 hours**
  after signing in — whichever comes first. You will simply be asked to sign in
  again.
- To sign out manually, use the **Logout** option in your account menu. Always log
  out on shared or public devices.
- The **NIB Super App** payment session is tied to your Super App login; closing
  the Super App ends it.

> ⚠ **Do not close the app while a payment is processing.** If you close early, use
> [Payment History](#13-payment-history-and-receipts) later to confirm whether the
> payment succeeded.

---

## 6. Accessing the System

### 6.1. Login and Authentication

**Paying through the NIB Super App**

The fastest way to pay is through the **NIB Super App**, which opens the NibTera
Edir payment page inside a secure, pre-authenticated session — no separate
password is required. See
[Section 9](#9-paying-contributions-through-the-nib-super-app) for the full
payment procedure.

**Signing in to the member portal**

If your Edir has issued you a **login account**, you can sign in to the web portal
for a richer experience.

1. Open the NibTera Edir sign-in page in your browser.
2. Enter your **email address** (or phone, if configured) and **password**.
3. Select **Sign in**.

You'll be taken to your **dashboard**. What you can see and do depends on the role
your Edir assigned to your account.

> **Note.** Sessions expire automatically for your protection — after **30 minutes
> of inactivity**, or **8 hours** after signing in, whichever comes first.

### 6.2. First-Time Setup

When your Edir creates your account, you receive a temporary or invitation
credential.

- **If you received an email invitation:** click the link in the email and follow
  the prompts to **set your own password**.
- **If you were given a temporary password:** sign in with it. You will be
  **required to change it immediately** before you can use any feature. This is a
  one-time, mandatory step.

Your new password must meet these rules:

| Requirement |
|-------------|
| At least **8 characters** long |
| At least one **uppercase** letter (A–Z) |
| At least one **lowercase** letter (a–z) |
| At least one **number** (0–9) |
| At least one **special character** (`! @ # $ % ^ & *`) |
| Must **not** be a password known to have been exposed in a public data breach |

> **Tip.** Choose a memorable passphrase you don't use anywhere else. The system
> checks your password against known breached-password lists and will reject
> anything found there.

**If you forget your password**

1. On the sign-in page, select **Forgot password?**
2. Enter your registered **email address**.
3. Check your inbox for a **password-reset link** and follow it to choose a new
   password (the same rules above apply).

> **Note.** Reset links expire after a short time for security. If yours has
> expired, simply request another. If you don't receive the email, check your spam
> folder or contact your Edir Administrator to confirm the email on file.

> ⚠ **Account lockout.** After several failed sign-in attempts your account is
> temporarily locked to protect it. Wait for the lockout to expire or ask your Edir
> Administrator to unlock it.

---

## 7. System Utilities

### 7.1. Switching Language (English / አማርኛ)

The payment mini-app is fully bilingual.

- Use the **EN / አማ** toggle in the top-right corner of the payment and history
  screens to switch between **English** and **Amharic (አማርኛ)** at any time.
- Your choice is remembered for future visits.

### 7.2. Notifications

NibTera Edir keeps you informed through in-app notifications and, where configured,
email:

- **Payment reminders** before contributions are due.
- **Request updates** when a self-service request changes status.
- **Security alerts** such as a new sign-in on your account or a password change.

Open the **notification bell** in the portal to review and mark notifications as
read.

---

## 8. Your Dashboard and Navigation

The dashboard is your home screen after signing in to the portal. Depending on
your role you may see:

- A **summary of your membership** and standing.
- **Notifications** about approvals, requests, and reminders.
- **Quick links** to the areas you're allowed to access.

Members with only basic access will see a focused view; staff and committee
members see more. Anything you're not permitted to open simply won't appear in your
navigation.

> **Note.** Your Edir controls what each account can access. If you need more
> access, contact your Edir Administrator.

---

## 9. Paying Contributions through the NIB Super App

The fastest way to pay is through the **NIB Super App**, which opens the NibTera
Edir payment page inside a secure, pre-authenticated session.

### Before you start

- You need the **NIB Super App** installed and be signed in to it.
- Your (or the member's) phone number should be the one registered with the Edir.

### Step-by-step

1. **Open the Edir payment service** from within the NIB Super App. The payment
   page opens automatically and establishes a secure session using your Super App
   login — you will **not** be asked for a separate password.
2. Your **phone number is pre-filled**. This is the number tied to your Super App
   session.
3. Tap **Fetch Member Data**. The app looks up the member registered to that phone
   number and displays their Edir, membership status, and everything currently owed.
4. Review the details carefully (see [Section 10](#10-understanding-your-payment-screen)).
5. Confirm or adjust the **Amount to pay**. The app suggests the full amount due,
   but you may pay a partial amount.
6. Tap the **Pay** button at the bottom of the screen.
7. The NIB Super App takes over to confirm and authorize the payment from your
   account.
8. When the bank confirms the payment, the screen updates in real time to a
   **"Payment received"** confirmation showing your previous balance, your new
   balance, and the months now covered.

> **Note.** The payment page must be opened **from inside the NIB Super App** to
> establish a secure payment session. If you open it in an ordinary browser you
> may see a warning that a secure session could not be started, and the final
> "Pay" hand-off will not be available.

> ⚠ **Do not close the app while a payment is processing.** The confirmation screen
> appears automatically once the bank settles the transaction. If you close early,
> use **Payment History** later to confirm whether it succeeded.

---

## 10. Understanding Your Payment Screen

After you fetch a member, the screen is organized top to bottom so you can verify
everything before paying.

| Section | What it shows |
|---------|---------------|
| **Who you are paying for** | A green banner ("Paying for your own membership") or an amber banner ("Paying on behalf of another member"). Always check this before you pay. |
| **Edir identity** | The name and logo of the Edir the payment will go to. |
| **Member identity** | The member's name, member ID, phone, and membership status (Active/Inactive). |
| **Key figures** | Four tiles: **Outstanding**, **Monthly Fee**, **Months Behind**, and **Contribution** status. |
| **This-month settlement** | A green confirmation if the current month is already fully paid, plus the next month you can pay ahead for. |
| **Contribution coverage** | The latest month you are paid through, the next due month, and — as you type an amount — how many months that amount will cover. |
| **What you owe (obligations)** | A detailed breakdown of the outstanding balance, this month's contribution, any installments, and any penalties or charges. |
| **Amount to pay** | The editable amount. Defaults to the full suggested total. |
| **View Payment History** | A link to your full transaction history and receipts. |

> **Note.** Payments are applied in a fixed order: **penalties → installments →
> monthly fee**. This is why paying a partial amount clears charges first.

### If the Edir cannot accept payments

Occasionally you may see a red banner saying the Edir's payment account is
unavailable. This happens when the Edir is not yet active or has not finished
configuring its bank account. The **Pay** button is disabled until this is
resolved. Contact your Edir Administrator.

---

## 11. Paying on Behalf of Another Member

You can pay for a family member, neighbour, or friend who belongs to an Edir.

1. On the payment screen, **change the phone number** in the "Member phone number"
   field to the member you want to pay for.
2. Tap **Fetch Member Data** again.
3. The banner at the top changes to an **amber "Paying on behalf of another
   member"** notice. Verify the member's name and details shown below it.
4. Enter the amount and pay as usual.

> **Note.** The payment is credited to **that member's** Edir account and
> obligations — not yours. Your own balance is unaffected.

> ⚠ **Always double-check the member's name and member ID** before confirming a
> payment on someone else's behalf.

---

## 12. Contribution Coverage, Penalties, and Installments

### Coverage — which months are paid

The **Contribution coverage** card explains your standing in plain terms:

- **Paid through** — the most recent month your contributions fully cover.
- **Next due month** — the next month you owe (or "Up to date" if none).
- **This pays for N months** — as you enter an amount, the app shows how many
  future months that amount will cover and through which month.

Paying **ahead** is allowed and encouraged — it extends your "Paid through" month
and prevents future penalties.

### Penalties and charges

If you have late or missed payments, the **Charges** section itemizes them:

| Charge type | Why it appears |
|-------------|----------------|
| **Late-payment penalty** | Added when a contribution is paid after the grace period. The rule, number of overdue days, and how it was calculated are shown. |
| **Event absence penalty** | Added when you missed an event that required attendance. |
| **Asset compensation** | Added when a borrowed Edir asset was lost or damaged. |
| **Reinstatement fee** | Added when a suspended or inactive membership is being reactivated. |

If you have no charges, you'll see a green **"No penalties or extra charges"**
message instead.

> **Note.** Penalty amounts and rules are set by your Edir, not by you. If you
> believe a penalty is incorrect, you can raise a **grievance** request (see
> [Section 14](#14-self-service-requests)) or contact your Edir Administrator, who
> can request a **penalty waiver** on your behalf.

### Installments

If you are paying a large amount over time (commonly the one-time registration
fee), the **Installments** section shows:

- Total number of installments, how many are **paid**, and how many **remain**.
- The **next installment** amount and its due date.
- The total installment amount still outstanding.

---

## 13. Payment History and Receipts

To review past payments:

1. On the payment screen, tap **View Payment History** (or open the history page
   directly with your phone number).
2. You'll see a list of transactions with amount, method, date, and status.
3. Use the **search box** to find a transaction by reference or method, and the
   **filter** to show only successful or only failed payments.
4. Tap any transaction to view its **receipt**.

> **Note.** Only **completed** (successful/partial) and **failed** payments are
> listed. In-progress or voided attempts are hidden so you are never misled into
> thinking a payment finished when it did not.

Receipts include the transaction reference, amount, date, and the Edir details —
keep the reference number if you ever need to query a payment.

---

## 14. Self-Service Requests

The portal lets you send structured requests to your Edir's staff and track their
outcome. Available request types:

| Request type | Use it to… |
|--------------|-----------|
| **Relative** | Ask to add or update a registered relative or beneficiary. |
| **Emergency** | Report an emergency (e.g. bereavement, illness) to start a benefit claim. |
| **Asset** | Request to borrow an Edir asset (tents, chairs, cooking equipment, etc.). |
| **Grievance** | Raise a complaint or dispute (for example, about a penalty). |
| **Feedback** | Share suggestions or general feedback. |

**How to submit a request**

1. Open the requests area of your portal.
2. Choose the **request type** and fill in the subject and description.
3. Attach any supporting documents if prompted (for example, a certificate for an
   emergency claim).
4. Submit.

**Tracking a request**

Each request moves through clear states:

| Status | Meaning |
|--------|---------|
| **Pending** | Received, awaiting review by Edir staff. |
| **In review** | An Edir staff member is working on it. |
| **Approved** | Accepted — it may proceed to the next step (e.g. an emergency claim). |
| **Rejected** | Declined. A reason is usually provided. |
| **Resolved** | Completed and closed. |

You'll be **notified** whenever the status changes, and staff may attach a written
response.

> **Note.** Approved emergency requests are handled by Edir staff through a formal
> **claim and disbursement** process with independent review before any payout.

---

## 15. Rules and Bylaws

Your Edir publishes its official **Rules & Bylaws** in the portal. This is the
authoritative, member-visible version and typically covers:

- Membership and eligibility
- Monthly contributions and due dates
- Emergency benefits and how claims are handled
- Suspension, termination, and reinstatement

Rules are **versioned** — when the Edir updates them, the new version is published
after formal approval, and older versions are retained for reference.

---

## 16. Managing Your Account and Security

From your **Account** area you can:

- **Update your profile** (name, contact details, avatar) where permitted.
- **Change your password** at any time.
- **Enable two-factor authentication (2FA)** for an extra layer of protection, if
  offered for your account.
- Review recent **sign-in activity**.

**Security features that protect you automatically:**

| Feature | What it does |
|---------|--------------|
| Mandatory first-login password change | Ensures no one keeps using a temporary password. |
| Breached-password screening | Blocks passwords known to be compromised. |
| Automatic session timeout | Signs you out after 30 minutes idle / 8 hours max. |
| Account lockout | Temporarily locks the account after repeated failed sign-ins. |
| New-login alerts | Emails you when a new session starts while another is active. |

---

## 17. FAQ & Troubleshooting

### 17.1. Common Issues

| Problem | What to do |
|---------|-----------|
| **"Member not found" when I fetch data** | Confirm the phone number is exactly the one registered with the Edir. Ask your Edir Administrator to verify the number on file. |
| **A secure session couldn't be started** | Open the payment page **from inside the NIB Super App**, not a standalone browser. |
| **The Pay button is disabled** | Either the amount is zero, or the Edir's payment account is not active/configured. Check the red banner and contact your Edir Administrator. |
| **My payment didn't show a confirmation** | Don't pay again immediately. Open **Payment History** to check whether it succeeded; look for the transaction reference. |
| **My balance didn't update after paying** | Give it a moment and re-fetch; settlement is near-instant but can take a few seconds. If it still shows unpaid after a while, check Payment History and contact your Edir. |
| **I can't sign in** | Use **Forgot password?**, or wait out a lockout, or ask your Edir Administrator to reset/unlock your account. |
| **A penalty looks wrong** | Raise a **grievance** request or contact your Edir Administrator, who can request a penalty waiver. |

### 17.2. Frequently Asked Questions

**Do I need a password to pay?**
No. Paying through the NIB Super App uses your existing Super App session. A
password is only needed for the optional member web portal.

**Can I pay more than I owe?**
Yes. Paying ahead extends your coverage to future months and helps you avoid
penalties.

**Can I pay part of what I owe?**
Yes. Partial payments are applied to penalties first, then installments, then the
monthly fee.

**Can I pay for my whole family?**
Yes — fetch each member by their registered phone number and pay on their behalf.
Verify the name each time.

**Is my payment instant?**
Confirmation is real-time. The screen updates automatically once the bank settles
the transaction.

**Where do I find a receipt?**
Open **Payment History** and tap the transaction. Each successful payment has a
receipt with a reference number.

**Why can't I see certain pages in the portal?**
Your Edir controls what each account can access. If you need more access, contact
your Edir Administrator.

---

## 18. Safety, Security, and Good Practice

NibTera Edir is secured to bank-grade standards, but your own habits matter too.
Follow these practices to keep your account and payments safe:

- **Never share your password or a one-time code with anyone**, including people
  claiming to be from your Edir or the bank. Staff will never ask for your password.
- **Only pay from inside the NIB Super App.** A genuine payment session starts
  there; be suspicious of any link asking you to "pay your Edir" elsewhere.
- **Always verify who you are paying for** — check the green/amber banner and the
  member's name and ID before confirming, especially when paying on someone's
  behalf.
- **Use a unique, memorable passphrase** for your portal login that you do not use
  on any other site.
- **Log out on shared or public devices**, and let the automatic session timeout
  protect you elsewhere.
- **Keep the reference number** from each receipt in case you ever need to query a
  payment.
- **Report anything suspicious** — an unexpected sign-in alert, a payment you did
  not make, or a penalty you cannot explain — to the contacts in
  [Section 19](#19-support-and-contacts).

---

## 19. Support and Contacts

### 19.1. Technical Support

For issues with the **NIB Super App**, your bank account, or a payment that did not
settle correctly, contact **NIB customer support** through the bank's official
support channels in the Super App.

### 19.2. Administrative Support

For matters specific to your Edir — membership details, the phone number on file,
account logins, penalties and waivers, self-service requests, and rules — contact
your **Edir Administrator**.

---

*For operational questions specific to your Edir, contact your **Edir
Administrator**. For issues with the NIB Super App or your bank account, contact
**NIB customer support**.*
