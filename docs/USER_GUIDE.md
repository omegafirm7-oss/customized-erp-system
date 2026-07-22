# ERP User Guide — Running the System Day to Day

This guide covers using the ERP as your company's real system of record: initial
setup, master data, the daily/monthly cycles of every module, and the reports.
The companion [HR_GUIDE.md](HR_GUIDE.md) covers Saudi payroll in more depth.

**Starting the system (this machine):**

```
# 1. Postgres (portable, port 5433) must be running
# 2. API:
pnpm --filter @erp/api start        # http://localhost:3000
# 3. Web:
pnpm --filter @erp/web dev          # http://localhost:5173
```

---

## 1. One-time company setup

1. **Register** your user (email + password) at `/register`, then log in.
2. **Companies → Create a company**: code (e.g. `MYCO`), legal name, country
   `SA`, currency `SAR`. Creating a company automatically provisions:
   - the full IFRS chart of accounts (editable under **Chart of Accounts**),
   - the current fiscal year with 12 monthly periods,
   - document numbering (INV-, PINV-, JE-, PYR-, DEPR-, …),
   - a default warehouse, HR settings with Saudi statutory defaults,
   - Administrator / Accountant / Viewer roles.
3. **Switch to the company** (top bar). Everything you do is scoped to the
   active company; you can run several businesses side by side.
4. **HR Settings**: check GOSI rates (9.75 / 11.75 / 2 % defaults), and fill
   the WPS fields (MOL establishment ID, employer bank code, IBAN) if you will
   pay salaries through a bank.
5. **ZATCA Settings** (when you e-invoice): onboard a device with your OTP
   from the Fatoora portal. The system is currently pointed at the **sandbox**;
   production onboarding uses the same wizard against the production endpoints.
6. **Opening balances**: post one manual journal entry (Journal Entries → New)
   dated the day before you go live — debit/credit each account to match your
   old trial balance. Post it; the system is now continuous with your history.

## 2. Master data

| What | Where | Notes |
|---|---|---|
| Customers & vendors | **Partners** | Set the VAT/TRN for B2B customers — ZATCA standard invoices need it. One partner can be BOTH. |
| Items & services | **Items** | Service items need a default sales (4xxx) and/or purchase (5xxx) account. Inventory items tick "inventory item" and get moving-average costing automatically. |
| Employees | **Employees** | Create one by one or bulk-import via the CSV template (button on the page). Salary split basic/housing/transport/other drives GOSI and WPS. |
| Equipment | **Equipment** | Cost, salvage, useful life. Choose "Capitalize — pay from …" to post the acquisition, or leave it if the asset is already in your opening balances. |
| Projects | **Projects** | For jobs you execute at a contract price. OVER_TIME = IFRS 15 percentage-of-completion; POINT_IN_TIME = ordinary invoicing. |
| Cost centers | auto | Each project/manpower contract/equipment contract creates its own (`PRJ-`/`MPR-`/`EQR-`). Department cost centers: POST /cost-centers or ask an admin. |

## 3. The three ways to earn revenue — pick per client engagement

**A. Trading / services (Sales Invoices).** Create draft → post. Inventory
items relieve stock and book COGS automatically. B2B invoices clear through
ZATCA at posting; B2C are reported. Collect via **Payments** (incoming),
allocated against open invoices.

**B. Supply / rental basis (Manpower & Equipment contracts).** You charge the
client for men and machines by the hour/day/month:
- **Manpower Contracts** → assign employees with bill rates → monthly
  **timesheet** (prefill, mark exceptions) → approve → **Generate invoice**.
- **Equipment Contracts** → assign machines with bill rates → monthly **usage
  log** (mark idle/breakdown) → approve → **Generate invoice**.
- Payroll and depreciation costs of assigned people/machines are tagged to the
  contract automatically → **Manpower/Equipment Profitability** reports show
  the real margin per client.

**C. Lump-sum contracting (Projects).** You build something for a fixed
contract value: create an OVER_TIME project (contract value + estimated cost),
tag all cost invoices to it, bill the client progress invoices (they post to
Contract Liability, not revenue), and run **revenue recognition** monthly —
revenue is earned by cost progress (IFRS 15), and the **WIP Schedule** shows
over/under-billing.

## 4. The monthly close cycle (checklist)

Run in this order each month:

1. **Timesheets / usage logs** for every active rental contract → approve →
   generate + post invoices.
2. **AP invoices** — enter all supplier bills for the month (tag lines to the
   project or contract cost center they belong to).
3. **Payroll run** for the period — exceptions arrive prefilled from approved
   timesheets; review, post, download the **WPS file**, pay via an outgoing
   payment against 2310, pay GOSI against 2320.
4. **Depreciation run** for the period (Equipment → Depreciation).
5. **Revenue recognition** for each OVER_TIME project (project detail page).
6. Review: **Trial Balance** (set the as-of date to the period end — postings
   made mid-month with later run dates need it), **VAT Return** for the filing
   window, **AR/AP Aging** for collections.
7. When done, close the period (period management API / soft-close) so nothing
   more posts into it.

Corrections never edit posted documents: cancel an invoice (posts a reversal),
reverse a run (payroll/revrec/depreciation are reverse-then-rerun), or post a
credit note. The audit trail stays intact.

## 5. Reports map

| Question | Report |
|---|---|
| Is the ledger balanced / what are my balances? | Trial Balance (as-of date!) |
| Who owes me / whom do I owe? | AR Aging / AP Aging |
| What VAT do I file? | VAT Return (date range) |
| What stock do I hold and at what value? | Stock Summary / Stock Movements |
| Is each construction job profitable? | Project Profitability + WIP Schedule |
| What do I file with GOSI? | GOSI Summary |
| What EOSB/leave liability do I carry? | EOSB & Leave |
| Is each manpower client profitable? | Manpower Profitability |
| What are my machines worth / earning? | Equipment fleet register + Equipment Profitability |

## 6. Users & roles

Invite colleagues per company and give them a role: **Administrator** (all),
**Accountant** (all operational modules, no user management), **Viewer**
(read-only reports and documents — deliberately *no* access to salaries).

## 7. Worked scenario — a client villa engagement (supply basis)

You supply a client with labour and machinery for their villa build, plus some
reimbursable expenses. See the chat walkthrough for the exact click-path; in
summary:

1. Partner: client as CUSTOMER (with TRN if a company).
2. Employees imported via CSV; machines registered under Equipment.
3. One **Manpower Contract** `VILLA-<client>` (rates per man) and one
   **Equipment Contract** `VILLA-<client>-EQ` (rates per machine) — both for
   that client.
4. Each month: enter the attendance into the manpower **timesheet** (absences,
   overtime), machine downtime into the **usage log** → approve → generate the
   two invoices → post (ZATCA) → collect payment.
5. Project expenses you incur: AP invoices with each line's **cost center**
   set to the contract's `MPR-`/`EQR-` center (reimbursables can be billed on
   via a manual line on the next sales invoice).
6. Payroll and depreciation runs pick the contract cost centers up
   automatically; the two Profitability reports then show exactly what the
   villa client earns you after labour, machine depreciation, and expenses.

If instead you contracted the villa at a fixed price, use pattern **C**: one
OVER_TIME Project, employees' cost centers pointed at the project, all costs
tagged to it, monthly progress billing + revenue recognition.
