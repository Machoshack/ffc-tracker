# FFC Patient Tracker

Internal app for Fresh Fit Consulting to track patients through programs, steps owed, P1 supplement budgets and margin, and device rentals.

Status: database, login, timeline, patient page, My queue, Patients list, Add patient, P1 supplements and tests, P1 margin, Settings, Dashboard, and Pipeline are built. More screens come next.

See `BACKLOG.md` for decisions made but not built yet.

## What's here

- `setup.sql`: everything below in one file, for pasting into the Supabase SQL Editor (rebuild with `npm run setup-sql`)
- `app/`, `components/`, `lib/`, `proxy.ts`: the web app (Next.js)
- `supabase/migrations/0001_schema.sql`: the tables
- `supabase/migrations/0002_scheduling.sql`: the rules (automatic steps, clinic-day snapping, shifting, hard blocks, FHE to P2 upgrade, supplement budget)
- `supabase/migrations/0003_views_audit_access.sql`: what the screens read, the audit log, and who can do what
- `supabase/migrations/0004_program_templates.sql`: FHE, Protocol I, Two-Step, Protocol II
- `supabase/migrations/0005_login_link.sql`: links logins to the staff list, sets the clock to Eastern time
- `supabase/migrations/0006_patient_names_dob.sql`: interim step (names and birth dates), superseded by 0007
- `supabase/migrations/0007_patient_codes.sql`: patients identified by code only (Mike Smith 1994 is MSMI94); names and birth dates removed
- `supabase/migrations/0008_fake_patient_codes.sql`: gives the fake test patients MSMI94-style codes
- `supabase/migrations/0009_p1_cost_model.sql`: P1 consults and staff $1,500, testing budget $900, supplements $600
- `supabase/seed.sql`: fake patients and staff only
- `supabase/remove-demo-data.sql`: removes the fake patients and deactivates the fake staff (run once in the SQL Editor)
- `tests/run-tests.mjs`: 88 checks run against a throwaway database

## Run locally

Copy `.env.example` to `.env.local` and fill in the Supabase URL and publishable key, then:

```
npm install
npm run dev
```

## Run the tests

```
npm install
node tests/run-tests.mjs
```

## Rules the database enforces

- Enrolling a patient creates every step with a due date, snapped to Mon, Wed or Fri (Tue to Wed, Thu to Fri, Sat to Fri, Sun to Mon).
- A step finished late, or rebooked later, pushes all later steps back by the same amount. Several items from one visit finishing late on the same day push the plan once.
- Hard blocks: FHE results consult waits for all three scores. Grip strength waits for body composition, BOLT waits for grip. Sleep score waits for the EEG device return. P1 Consultation 1 waits for Test 1 results. Two-Step Session 1 waits for payment. Each block can be switched off per step.
- One open program per patient.
- FHE to P2 upgrade within 31 days of the FHE finishing: finished steps carry over, payment is credited.
- P1 supplements: wholesale is 50% of retail unless entered. Budget $600 wholesale. The app warns before an entry would go over.
- P1 margin: fee minus $1,200 consults, $200 staff time, test costs, and supplement wholesale cost.
- Only admins change programs, budgets and staff accounts, or delete records. Every change is logged with who made it. Nobody can edit the log.

## Not real patient data

Use fake data only until hosting and database are covered by signed BAAs (see the project brief, section 8).
