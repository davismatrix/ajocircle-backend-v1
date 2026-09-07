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

The test covers registration, invitations and acceptance, role changes, activation, dashboard and history queries, contribution verification, and notifications.

## Web UI (Slice 2)

The Next.js UI lives in `web/`. It currently provides registration, login, session restoration, sign-out, and a protected dashboard shell.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000. The API allows this origin by default; set `CORS_ORIGINS` in the backend `.env` if you host the UI elsewhere.

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
