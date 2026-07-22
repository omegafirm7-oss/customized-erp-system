# HR & Saudi Payroll — User Guide

This module runs full Saudi-statutory payroll: GOSI contributions, WPS bank
files, end-of-service benefits (EOSB) and annual-leave provisions accrued
monthly to the General Ledger, employee loans recovered through payroll, and
final settlements on termination. Every payroll posting is a normal journal
entry — visible in Journal Entries and the Trial Balance like everything else.

---

## 1. One-time setup

### 1.1 HR Settings (screen: **HR Settings**)

| Setting | Default | Meaning |
|---|---|---|
| Saudi employee % | 9.75 | Employee GOSI share (annuities + SANED), deducted from pay |
| Saudi employer % | 11.75 | Employer GOSI share (annuities + SANED + hazards), company cost |
| Expat employer % | 2.00 | Employer-only hazards rate for non-Saudis |
| Wage floor / cap | 1,500 / 45,000 | GOSI wage base (basic + housing) is clamped to this range |
| Overtime × | 1.5 | Statutory overtime multiplier on the basic hourly rate |
| Hours/day, Days/month | 8 / 30 | Payroll conventions used for daily/hourly rates |
| Annual leave days | 21 | Default entitlement for new employees (30 after 5 years service is a per-employee setting) |
| EOSB wage basis | Full gross | Wage used for EOSB/leave provisions (Labor Law uses the full last wage) |
| WPS identifiers | — | MOL establishment ID, employer bank code and IBAN — required before a WPS file can be generated |

GOSI rates change under the new Social Insurance Law — when they do, update
them **here**; nothing is hardcoded.

### 1.2 Load employees (screen: **Employees**)

Either create employees one by one, or bulk-load:

1. Click **Download import template** — a CSV with the exact column order and
   two sample rows (one Saudi, one expat).
2. Fill it in Excel (keep the header row, save as CSV).
3. Click **Import CSV**. The import is all-or-nothing: any row errors are
   reported with row numbers and nothing is saved until the file is clean.

Template columns:

| Column | Notes |
|---|---|
| `code` | Unique employee number, e.g. EMP-001 |
| `nameEn`, `nameAr` | English name required; Arabic optional |
| `nationality` | Free text (SA, IN, PK, …) |
| `isSaudi` | `true`/`false` — drives GOSI treatment |
| `iqamaOrNationalId`, `iqamaExpiry` | ID number + expiry (YYYY-MM-DD). Expiring documents show badges on the Employees screen |
| `passportNumber`, `passportExpiry` | Optional |
| `gosiNumber` | GOSI registration number (appears on the GOSI summary) |
| `joinDate` | YYYY-MM-DD — drives EOSB and leave accrual from day one |
| `contractType` | `UNLIMITED` or `LIMITED` |
| `bankCode`, `iban` | Required for the WPS file |
| `costCenterCode` | Optional cost center (department **or a project's PRJ-code** — labor then flows into job costing) |
| `annualLeaveDays` | Blank = company default |
| `basicSalary`, `housingAllowance`, `transportAllowance`, `otherAllowance` | Monthly amounts. GOSI base = basic + housing |
| `gosiExempt` | `true` only for special cases — skips GOSI entirely |

### 1.3 Employee loans (screen: employee detail page)

Enter principal, monthly installment and the bank/cash account paying it out.
Posting is immediate: **Dr 1160 Employee Loans / Cr bank**. The installment is
auto-deducted in every payroll run until the balance reaches zero (the last
deduction is capped at the remaining balance). A loan with no deductions yet
can be cancelled (reverses the disbursement).

---

## 2. The monthly payroll cycle

1. **Create the draft** — Payroll Runs → pick the fiscal period → **New
   payroll run**. Every active employee (joined on or before period end) gets
   a line computed from their salary structure, GOSI rules and due loan
   installments.
2. **Enter exceptions** — click **Edit** on a line: unpaid days, absent days,
   overtime hours, annual leave days taken, other deduction. Everything else
   recomputes on save. (Employees with no exceptions need no touch.)
3. **Review** — the header shows gross, GOSI shares, loans, EOSB/leave deltas
   and total net. **Recompute** re-pulls master data if salaries or loans
   changed since the draft was created.
4. **Post** — one balanced journal entry, dated at period end:

   | Leg | Account | Side |
   |---|---|---|
   | Gross salaries (per cost center) | 5200 Salaries & Wages | Dr |
   | Employer GOSI (per CC) | 5250 GOSI Expense | Dr |
   | EOSB accrual delta (per CC) | 5260 EOSB Expense | Dr |
   | Leave accrual delta (per CC) | 5270 Leave Expense | Dr |
   | GOSI (employee + employer) | 2320 GOSI Payable | Cr |
   | Loan installments | 1160 Employee Loans | Cr |
   | EOSB provision delta | 2520 EOSB Provision | Cr |
   | Leave provision delta | 2340 Leave Provision | Cr |
   | Net pay | 2310 Accrued Salaries Payable | Cr |

5. **Pay salaries** — Payments → new **outgoing payment** against 2310 from
   your bank account, and download the **WPS file** from the posted run to
   upload to your bank (Mudad format: employer header + one row per employee
   with IBAN, basic, housing, other earnings, deductions, net).
6. **File GOSI** — the **GOSI Summary** report shows per-employee wage base
   and shares for the period, matching what the GOSI portal expects.
7. **Pay GOSI** — outgoing payment against 2320 when you settle the monthly
   bill.

Mistake in a posted run? **Reverse** it (allowed only for the latest posted
run, reversal is dated into the same period), fix the inputs, run again. One
posted run per period is enforced by the database.

### Worked example (what the math does)

Saudi employee: basic 10,000 + housing 2,500 + transport 1,000. Loan
installment 1,000/month. This month: 2 unpaid days, 10 overtime hours.

- GOSI base = 10,000 + 2,500 = 12,500 → employee 9.75% = **1,218.75**,
  employer 11.75% = **1,468.75**
- Overtime = 10,000 / 30 / 8 × 1.5 × 10 = **625.00**
- Unpaid days = 13,500 / 30 × 2 = **900.00**
- Gross = 13,500 − 900 + 625 = **13,225.00**
- **Net = 13,225 − 1,218.75 − 1,000 = 11,006.25**
- EOSB accrual (first month, full-gross basis) = 13,500 × ½ ÷ 12 = **562.50**
- Leave accrual = 1.75 days ≙ 13,500 / 30 × 1.75 = **787.50**

---

## 3. EOSB and leave — how the provisions work

**EOSB (Labor Law Art. 84):** half a month's wage per service year for the
first five years, a full month per year after that. Each payroll run tops the
provision up to the entitlement as of period end (2520). Your balance sheet
always carries the true liability; the **EOSB & Leave** report reconciles
entitlement vs provision per employee.

**Art. 85 (resignation):** under 2 years — nothing; 2–5 years — one third;
5–10 years — two thirds; 10+ — full. Employer-initiated termination and
limited-contract expiry always pay in full. The provision accrues at the full
amount; the resignation reduction is recognized at settlement (the forfeited
part credits EOSB expense).

**Leave:** days accrue monthly (entitlement ÷ 12); taken days are recorded on
payroll lines; the provision (2340) is the balance × daily full-gross wage,
retargeted each run.

---

## 4. Termination / final settlement

On the employee page → **Termination & final settlement**:

1. Pick the reason (drives the Art. 85 factor) and last working day.
2. **Preview** shows: final salary days since the last posted run, EOSB
   payable, leave-balance payout, loan recovery, net amount.
3. **Post settlement & terminate** — clears the employee's share of the
   2520/2340 provisions, recovers outstanding loans, credits the net to 2310
   (pay it like a salary), and marks the employee TERMINATED (excluded from
   future runs). A settlement can be reversed, which also reactivates the
   employee.

---

## 5. Reports

| Report | Where | What it answers |
|---|---|---|
| Payroll register | Run detail + **Register CSV** download | Full per-employee breakdown of a run |
| GOSI Summary | Reports → GOSI Summary | Monthly filing figures per employee |
| EOSB Liability | Reports → EOSB & Leave | Entitlement vs provision per employee |
| Leave Balances | Reports → EOSB & Leave | Accrued/taken/balance + provision |
| Expiring documents | `GET /hr/employees/expiring-documents` (badges on Employees screen) | Iqamas/passports expiring within 90 days |

## 6. Permissions

| Permission | Grants |
|---|---|
| `hr.employee.view` | Read employees, runs, HR reports |
| `hr.employee.manage` | Create/edit employees, loans, terminations |
| `hr.payroll.run` | Create/post/reverse payroll runs, WPS files |
| `hr.settings.manage` | Edit HR settings |

The **Accountant** role has all four. The **Viewer** role has none — salary
data is not visible to viewers by design.
