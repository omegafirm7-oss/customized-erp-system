# ERP System — Phase 1: Foundation

Multi-company ERP foundation (auth, chart of accounts, general ledger, master
data) built to be extended with e-Invoicing/VAT (ZATCA), Finance, HR,
Manpower Rental, Equipment Rental, Trading & Inventory, and Projects modules.
See [`plan`](#) used to build this (Phase 1 Foundation) and the roadmap for
subsequent modules below.

**Status: Phase 1 is built, migrated, seeded, and verified working end-to-end** (both e2e tests and a live browser walkthrough — register → login → create company → auto-provisioned COA → post a balanced journal entry → Trial Balance) against a real PostgreSQL instance.

## Prerequisites

- Node.js 20 LTS — https://nodejs.org or `winget install OpenJS.NodeJS.LTS`
- pnpm — `npm install -g pnpm`
- Docker Desktop (for local Postgres) — or point `DATABASE_URL` at any
  Postgres 14+ instance you already have.

## Setup

```bash
pnpm install

# Build the shared workspace packages first — apps/api runs compiled JS
# directly on Node (no bundler), so @erp/shared-constants and
# @erp/shared-types must be pre-compiled to dist/ before apps/api can
# `require()` them. (apps/web doesn't need this — Vite transpiles on the fly.)
pnpm --filter "@erp/shared-constants" build
pnpm --filter "@erp/shared-types" build

# Start Postgres
docker-compose up -d

# Copy env and adjust secrets if needed
cp .env.example apps/api/.env

# Create the database schema
pnpm --filter @erp/api exec prisma migrate dev --name init

# Apply the DB-level GL constraints (CHECK + immutability triggers) —
# see apps/api/prisma/sql/gl-constraints.sql for why this is a separate step
pnpm --filter @erp/api exec prisma migrate dev --create-only --name add_gl_constraints
# then paste the contents of apps/api/prisma/sql/gl-constraints.sql into the
# generated migration.sql file before running:
pnpm --filter @erp/api exec prisma migrate dev

# Seed the global catalog (currencies, account classes, permissions)
pnpm prisma:seed

# Run the API and web app
pnpm dev:api    # http://localhost:3000  (Swagger docs at /docs)
pnpm dev:web    # http://localhost:5173
```

### Alternative: portable PostgreSQL (no Docker, no Windows service)

On this dev machine, the Windows PostgreSQL MSI installer got wedged mid-install
(an elevated, unkillable process) and Docker wasn't available either, so this
environment actually runs Postgres from the portable ("binaries-only") zip
distribution instead — no installer, no Windows service, no admin rights
needed:

```powershell
# One-time setup (already done here, kept for reference):
# 1. Download & extract postgresql-<version>-windows-x64-binaries.zip to D:\pgportable
# 2. Initialize a data dir with a known password:
D:\pgportable\pgsql\bin\initdb.exe -D D:\pgportable\data -U postgres --pwfile=D:\pgportable\pwfile.txt -E UTF8 --locale=C

# Start/stop (each session):
D:\pgportable\pgsql\bin\pg_ctl.exe -D D:\pgportable\data -o "-p 5433" -l D:\pgportable\logfile.txt start
D:\pgportable\pgsql\bin\pg_ctl.exe -D D:\pgportable\data stop
```

`apps/api/.env` on this machine points `DATABASE_URL` at `localhost:5433`
(not the `docker-compose.yml` default of `5432`) with role/database `erp` /
`erp_dev_password`, created via:
`psql -U postgres -h localhost -p 5433 -c "CREATE ROLE erp WITH LOGIN PASSWORD 'erp_dev_password' CREATEDB;" -c "CREATE DATABASE erp OWNER erp;"`

If you have Docker available, prefer `docker-compose up -d` with the default
`.env.example` (port 5432) instead — it's simpler to reset/tear down.

## Running tests

```bash
pnpm --filter @erp/api test:e2e
```

Requires `DATABASE_URL` to point at a real Postgres database with migrations
applied (these are integration tests that exercise real row locks and DB
triggers, not mocks).

## Phase 1 acceptance walkthrough

1. Register a user and log in at http://localhost:5173.
2. Create a company — this auto-provisions a cloned default IFRS chart of
   accounts, an open fiscal year with 12 monthly periods, a `JOURNAL_ENTRY`
   numbering series, and the Administrator/Accountant/Viewer roles.
3. Create a second company and switch between them via the top-bar selector
   — each company's Chart of Accounts and Journal Entries are isolated.
4. Post a manual journal entry (e.g. Dr Cash 10,000 / Cr Share Capital
   10,000) — unbalanced entries are rejected, and posted entries become
   immutable (edit/delete attempts fail both at the API and the database
   trigger level).
5. Reverse a posted entry — a linked reversal entry is created and the
   original is marked `REVERSED`.
6. Close a fiscal period and confirm posting into it is rejected.
7. View the Trial Balance report and confirm total debits equal total
   credits.

## ZATCA e-Invoicing (Phase 3)

Sales invoices are automatically submitted to ZATCA (Fatoora) once a company
onboards an EGS device (ZATCA Settings page, or `POST /zatca/devices/onboard`).
B2B invoices (buyer has a TRN) are cleared in real time; B2C invoices carry a
TLV QR code and are reported. The full pipeline — UBL 2.1 XML, secp256k1
XAdES signing, ICV/PIH hash chaining, CSID onboarding — is implemented in
`apps/api/src/zatca/`.

- Requires `ZATCA_KEY_ENCRYPTION_KEY` in `apps/api/.env` (32-byte key
  encrypting device private keys + CSID secrets at rest).
- A ZATCA outage never blocks posting: the invoice posts locally with a
  PENDING submission; retry from the invoice list or
  `POST /zatca/submissions/:id/retry`.
- REJECTED submissions are terminal — the accounting stays posted; issue a
  credit note and a corrected invoice.
- Standard-invoice XML downloads serve only the ZATCA-cleared document.
- Live sandbox verification: `ZATCA_SANDBOX_E2E=1 pnpm --filter @erp/api
  exec jest --config ./test/jest-e2e.json --testPathPattern zatca-sandbox`
  (needs outbound internet; excluded from normal runs).

## Roadmap after Foundation

1. ~~Finance Management (AR/AP)~~ ✔ Phase 2
2. ~~e-Invoicing & VAT (Saudi ZATCA Fatoora)~~ ✔ Phase 3
3. Trading & Inventory Management
4. Projects
5. Human Resource Management
6. Manpower Rental
7. Equipment Rental

See the Phase 1 plan for the reasoning behind this sequencing.
