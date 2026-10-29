# AjoCircle Backend V1

Production-oriented starter backend for an Ajo/rotating savings application.

Stack: FastAPI, PostgreSQL, SQLAlchemy 2, Alembic, JWT authentication.

V1 supports:
- user registration/login
- Ajo group creation
- member management
- group activation and automatic cycle generation
- contribution submission and admin verification
- payout recording
- financial ledger
- audit logging

V1.1 adds:
- group invitations by phone number, with expiry and acceptance flow
- persisted in-app notification inbox and a WhatsApp-ready delivery outbox
- group dashboard, contribution history, and cycle history endpoints
- clearer group-role enforcement for administration operations

Important: V1 records payments; it does not custody funds or initiate bank transfers. Real payment integrations should be added behind a provider abstraction after compliance/security review.

## V1.1 endpoints

- `POST /api/v1/ajo-groups/{ajo_id}/invitations`
- `POST /api/v1/ajo-groups/invitations/accept`
- `PATCH /api/v1/ajo-groups/{ajo_id}/members/{member_id}/role`
- `GET /api/v1/auth/me`, `GET /api/v1/ajo-groups`, `GET /api/v1/ajo-groups/{ajo_id}/members`
- `GET /api/v1/ajo-groups/{ajo_id}/dashboard`
- `GET /api/v1/ajo-groups/{ajo_id}/contributions/pending` (owner, admin, or treasurer)
- `GET /api/v1/ajo-groups/{ajo_id}/contributions/history`
- `GET /api/v1/ajo-groups/{ajo_id}/cycles/history`
- `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/{notification_id}/read`

The default `NOTIFICATION_PROVIDER=LOG` persists WhatsApp-targeted notifications as queued outbox records. It deliberately does not send messages to an external provider.

## Run integration tests

Integration tests use an isolated PostgreSQL service (`db_test`) and never connect to the development database.

```bash
docker compose --profile test run --rm test
```

The tests cover registration, invitations and acceptance, role changes, activation, dashboards, histories, notifications, payment integrity, currency, scheduling, and concurrent duplicate payment actions. Tests run the Alembic migrations in both directions.

Direct test runs require an explicit `TEST_DATABASE_URL` whose database name ends in `_test`. The fixture refuses to run otherwise, before loading the application database configuration. Use a disposable test database: the suite creates and removes its application tables.

## Web UI (Slice 2 - 3)

The Next.js UI lives in `web/`. It currently provides registration, login, session restoration, sign-out, a protected My Ajos page, a create-group form, and group dashboards with role-aware actions. Sessions use an HttpOnly cookie through a same-origin Next.js API proxy; access tokens are never returned to browser JavaScript. Production cookies require HTTPS.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Set server-only `API_URL` in `web/.env.local` to the backend URL (default `http://localhost:8000/api/v1`). The browser calls the Next.js proxy, so it does not require cross-origin API access. The previous `NEXT_PUBLIC_API_URL` variable is no longer used. Restart Next.js after changing environment variables.

From `web/`, run session tests with `npm test`, lint with `npm run lint`, and validate a production build with `npm run build`.

For browser tests, install Chromium once and run:

```bash
npx playwright install chromium
npm run test:e2e
```

These tests use mocked API responses and start their own Next.js dev server on port 3100. They cover desktop and mobile group creation, list refresh after creation, errors/retry, and authentication redirects without touching PostgreSQL.

For a live browser test against FastAPI and PostgreSQL, start the isolated services from the repository root:

```bash
docker compose --profile e2e up --build -d --wait api_e2e
cd web
npm run test:e2e:live
```

The live suite registers a fresh account, creates a group, deliberately drops its successful creation response, reloads the page, safely retries, reviews all saved settings, edits the draft, finds it in My Ajos, and cancels it. It runs on desktop and mobile. Its API uses port 8100, its UI uses 3101, and its PostgreSQL database is separate from both development and pytest. Test servers use separate Next.js build directories. Stop only the live services from the repository root when finished:

```bash
docker compose --profile e2e stop api_e2e db_e2e
```

The live database uses temporary storage and is cleared when stopped.

To try Slice 3 manually: sign in, open **My Ajos**, select **Create a group**, fill out the form, and submit. You land on the new draft group overview; return to **My Ajos** to see its card. Rotational payouts and zero late fees match the current backend rules. Owners can review every saved setting, edit drafts, or cancel them with confirmation. Cancellation retains the group and audit records, cancels pending invitations, and prevents activation. The dashboard displays the current cycle, next contribution, payout position, and activity. It provides role-aware activation, invitation creation, role updates, contribution submission, and verification. The invitation acceptance screen and full history pages are later slices.

## Run

```bash
cp .env.example .env
docker compose up --build
```

Then run the migration:

```bash
docker compose exec api alembic upgrade head
```

API docs: http://localhost:8000/docs

## Supported group and payment rules

- Owners can edit or cancel DRAFT groups. Admins and members cannot edit/cancel, and ACTIVE/CANCELLED groups cannot be edited. Cancelled groups remain visible for reference.
- Membership additions, invitation creation, and invitation acceptance are allowed only in DRAFT groups. Activation freezes the roster and generates the full rotation.
- Frequencies: DAILY, WEEKLY, MONTHLY. Payout type: ROTATIONAL. Other values are rejected.
- Contribution deadlines are the cycle start plus `grace_period_days`.
- Automated late fees are not implemented; nonzero `late_fee` values are rejected. Existing groups with unsupported settings must be corrected before activation.
- A contribution submission must equal the scheduled amount. Partial payments and top-ups are not supported; existing partial submissions cannot be verified.
- A payout must equal its expected amount and requires sufficient verified contributions for its own cycle.
- Ledger entries use the group's currency. Previously recorded entries are not rewritten automatically.
- Duplicate submissions, verifications, payouts, and activation/membership changes are serialized using PostgreSQL row locks.

`.env` and generated caches are ignored by Git and excluded from the backend image. If a real credential was previously committed, rotate it; removing the file from tracking does not remove Git history.

## Group creation safety and validation

- Supported currencies for new/edited groups: NGN, USD, CAD, GBP, EUR.
- New and edited start dates must be today or later in UTC. Activation also requires a current/future start date. Update a draft's date if it has passed.
- Grace periods must be between 0 and 365 days.
- Names are trimmed and require 2–255 characters; descriptions are limited to 2,000 characters. Amounts must be positive, with at most two decimal places and 18 total digits.
- `POST /api/v1/ajo-groups` accepts an optional UUID `Idempotency-Key` header. Keys are scoped to the authenticated user and stored atomically with the group. The same key and normalized settings return the existing group (HTTP 200); different settings with that key return HTTP 409. New creations return HTTP 201. Replaying a creation does not undo later edits or cancellations, and the key does not expire.
- The UI always sends a creation key. It keeps uncertain requests in per-user session storage, including their original settings, so a same-tab reload can safely recover the group. Settings stay locked until the request is resolved. If browser storage is disabled, retries remain protected while the page stays open. API callers must reuse their request key after a lost response.
- `PATCH /api/v1/ajo-groups/{id}` replaces draft settings using the complete creation-form payload; `POST /api/v1/ajo-groups/{id}/cancel` cancels a draft. Both are owner-only and serialized with activation and membership changes.
- Group creation, details, listings, and dashboard responses include description, grace period, and late fee. Existing financial records are not rewritten by these changes.

Apply migration `0003_group_creation_requests` before using creation keys:

```bash
docker compose exec api alembic upgrade head
docker compose restart api
```

## Group dashboard

The dashboard uses `GET /api/v1/ajo-groups/{id}/dashboard`. The group owner and admins may activate a draft and invite members; only the owner may change member roles. Active members can submit their own scheduled contribution. Owners, admins, and treasurers can review submitted contributions and verify them after confirming payment externally. Invitation tokens must be shared manually; WhatsApp delivery is not enabled. Accepting invitations through the UI remains a later slice.

The backend integration suite checks role boundaries and dashboard state. The live browser suite exercises registration, invitation creation and API acceptance, activation, contribution submission, and verification using the isolated test services described above.
