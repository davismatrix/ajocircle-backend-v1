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

## Web UI (Slice 2)

The Next.js UI lives in `web/`. It currently provides registration, login, session restoration, sign-out, and a protected dashboard shell. Sessions use an HttpOnly cookie through a same-origin Next.js API proxy; access tokens are never returned to browser JavaScript. Production cookies require HTTPS.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. Set server-only `API_URL` in `web/.env.local` to the backend URL (default `http://localhost:8000/api/v1`). The browser calls the Next.js proxy, so it does not require cross-origin API access. The previous `NEXT_PUBLIC_API_URL` variable is no longer used. Restart Next.js after changing environment variables.

From `web/`, run session tests with `npm test`, lint with `npm run lint`, and validate a production build with `npm run build`.

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

- Membership additions, invitation creation, and invitation acceptance are allowed only in DRAFT groups. Activation freezes the roster and generates the full rotation.
- Frequencies: DAILY, WEEKLY, MONTHLY. Payout type: ROTATIONAL. Other values are rejected.
- Contribution deadlines are the cycle start plus `grace_period_days`.
- Automated late fees are not implemented; nonzero `late_fee` values are rejected. Existing groups with unsupported settings must be corrected before activation.
- A contribution submission must equal the scheduled amount. Partial payments and top-ups are not supported; existing partial submissions cannot be verified.
- A payout must equal its expected amount and requires sufficient verified contributions for its own cycle.
- Ledger entries use the group's currency. Previously recorded entries are not rewritten automatically.
- Duplicate submissions, verifications, payouts, and activation/membership changes are serialized using PostgreSQL row locks.

`.env` and generated caches are ignored by Git and excluded from the backend image. If a real credential was previously committed, rotate it; removing the file from tracking does not remove Git history.
