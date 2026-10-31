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

To try Slice 3 manually: sign in, open **My Ajos**, select **Create a group**, fill out the form, and submit. You land on the new draft group overview; return to **My Ajos** to see its card. Rotational payouts and zero late fees match the current backend rules. Owners can review every saved setting, edit drafts, or cancel them with confirmation. Cancellation retains the group and audit records, cancels pending invitations, and prevents activation. The dashboard displays the current cycle, next contribution, payout position, and activity. It provides role-aware activation, invitation creation, role updates, contribution submission, and verification. Invitation links, acceptance, and member roster views are available; contribution and cycle history pages are linked from the group dashboard.

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

The dashboard uses `GET /api/v1/ajo-groups/{id}/dashboard`. The group owner and admins can review the exact roster and payout order before activating a draft, create invitations, recover pending invitation tokens, and cancel pending invitations; only the owner may change member roles. Active members can submit their own scheduled contribution. Owners, admins, and treasurers can review submitted contributions and verify them after confirming payment externally. Activation is blocked until all unexpired invitations are accepted or cancelled; the submitted preview hash prevents activation if the roster or settings change after review. Invitation tokens must be shared manually; WhatsApp delivery is not enabled. Invited users can accept at `/invitations/accept` or use the shareable link.

The backend integration suite checks role boundaries and dashboard state. The live browser suite exercises registration, invitation creation and UI acceptance, activation, contribution submission, and verification using the isolated test services described above.

## Dashboard safety and recovery

`GET /api/v1/ajo-groups/{id}/activation-preview` gives owners and admins the draft settings, the exact generated payout order, pending invitation count, and a preview hash. The dashboard sends that hash on activation; stale previews are rejected. Other API clients may omit the hash for compatibility, but activation always rejects unexpired pending invitations. Owners and admins can retrieve unexpired tokens using paginated `GET /api/v1/ajo-groups/{id}/invitations` or cancel one with `POST /api/v1/ajo-groups/{id}/invitations/{invitation_id}/cancel`. Cancellation also cancels the queued outbox entry. Expired invitations cannot be accepted and do not block activation.

Before recording a contribution, members review its fixed amount, due date, payment method, and reference, then confirm or return to edit. Payment details are trimmed and blank values are rejected. Submission and verification controls block repeated requests while in flight. Success notices remain visible if the dashboard refresh fails, and a new schedule gets a fresh submission form. Uncertain verification blocks further verification and pagination until its status is checked.

Contribution submission is safe to retry with identical amount, payment method, and reference: the API returns the existing record without another ledger or audit entry. Different payment details for the same schedule return 409. The dashboard keeps uncertain submissions in same-tab session storage until their status is checked or the identical submission is retried; if storage is unavailable, same-page retries still retain the original details. Verification status can be checked before retrying an uncertain verification. Status endpoints are permission checked, and verification remains a manual confirmation of an external payment.

## Invitation acceptance

Owners and admins can copy a pending invitation token or link from the group dashboard. Links place the token in the URL fragment, which is not sent to the server. The acceptance page removes the fragment from the address bar and keeps the token in same-tab session storage through sign-in or registration. If session storage is unavailable, users can paste the token after signing in. Return paths after authentication are restricted to the invitation page.

The signed-in account must have the invited phone number. Invalid, expired, cancelled, mismatched, or already-used invitations return an error. If the same account retries an acceptance after losing the response, the existing membership is returned without a second audit entry or notification, including after activation. A cancelled group cannot be joined. Every member can view the roster; only the owner can change roles, and cancelled groups cannot have roles changed.

Invitation links and tokens have copy buttons with a manual-selection fallback. Invitations for existing members are rejected. If a role-update response is lost, the UI checks the roster and blocks further role edits until the result can be confirmed. A second invitation link can be opened in the same tab, including after a successful acceptance.

Invitation acceptance requires verification of the matching phone number. Registration phone numbers are self-reported until verified; claiming a number does not reserve it or authorize an invitation. Invitation links and tokens are bearer secrets: share them securely.

## Phone verification

Phone verification uses [Firebase Authentication phone sign-in](https://firebase.google.com/docs/auth/web/phone-auth), which sends an SMS and uses reCAPTCHA. AjoCircle's existing email/password login is unchanged. The backend verifies Firebase ID tokens against the configured project, requires a fresh phone sign-in for the requested number, and verifies the existing authenticated AjoCircle account. A previously self-reported number is not proof of ownership.

1. Create a Firebase project and a web app. Enable Authentication's Phone provider, configure the SMS region policy and authorized domain, and configure billing as required by Firebase. Firebase SMS is subject to charges and quotas. Google stores and uses submitted phone numbers for spam and abuse prevention.
2. In the root `.env`, set `PHONE_VERIFICATION_PROVIDER=FIREBASE` and `FIREBASE_PROJECT_ID` to your project ID. Provide Application Default Credentials to the API. For local Docker, put a Firebase service-account JSON file at the project root as `.env.firebase-service-account.json` (ignored by Git and Docker builds), and set `GOOGLE_APPLICATION_CREDENTIALS=/app/.env.firebase-service-account.json` in `.env`; the existing development bind mount makes it available to the API. Never commit the credential file.
3. In `web/.env.local`, set `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID` from the Firebase web app configuration. The frontend and backend project IDs must match. Restart the web server after changing them.
4. Rebuild and restart the API with `docker compose up --build -d api`, apply the existing migration with `docker compose exec api alembic upgrade head`, and restart the web app. Firebase's documentation notes restrictions on localhost for phone authentication; use a supported authorized domain when testing actual SMS.

The default provider is `DISABLED` and fails closed. From the invitation page or **Phone verification** in the dashboard, enter an international number, request an SMS, and enter the code. A browser reload requires a new SMS request. Pending YCloud attempts cannot be used after switching providers; previously verified accounts and memberships remain unchanged. The API allows five verification requests per hour per account and phone by default; set `PHONE_VERIFICATION_REQUESTS_PER_HOUR` in the backend environment to change this limit. The 60-second resend cooldown and five code checks per attempt still apply. Firebase sends SMS directly from the browser: configure Firebase's SMS region policy, quotas and abuse controls independently. Use Firebase's fictional test numbers only in a separate non-production Firebase project: those numbers do not prove ownership.

Existing self-reported numbers remain visible but unverified. Migration `0004_phone_verification` preserves them as claims and clears the uniquely reserved verified-number field. A verified number can belong to only one account; users must verify a replacement before changing it. Downgrade refuses to discard duplicate claims that cannot fit the old unique-number schema. The isolated backend tests use a deterministic `TEST` provider only with `APP_ENVIRONMENT=test`; it must never be enabled in a deployed environment.


## History and records (Slice 7)

Open **Contribution history** or **Cycle history** from a group dashboard. Contribution history shows due dates, expected and recorded amounts, payment references, and submission/verification timestamps. Ordinary members see only their own contributions; owners, admins, and treasurers can view all contributions and filter by member. Cycle history shows recipients, periods, expected and recorded payouts, payout status, and payment dates for all group members.

The pages are `/dashboard/ajos/{id}/contributions` and `/dashboard/ajos/{id}/cycles`. URLs preserve `page`, `page_size`, contribution `status` and `member_id`, or cycle `payout_status`. Filters reset pagination to page one; reload and browser back/forward restore the selected view. Shared history links preserve their filters through login. Invalid URLs and out-of-range pages offer recovery links. History APIs return typed fields with money serialized as decimal strings and deterministic ordering. Existing memberships and financial records require no migration for these screens.


## Notification inbox (Slice 8)

Open **Notifications** in the dashboard navigation. The badge counts unread delivered in-app messages and refreshes on navigation, tab focus, inbox/contribution actions, and every 30 seconds while the tab is visible. An unavailable count is shown as `!`, not as a misleading zero.

The inbox supports all/unread filtering, explicit mark-as-read actions, and URL pagination (`page` and `unread_only`). It fetches `GET /notifications` using `limit` and `offset`, so records older than the first 100 remain accessible. Marking read is idempotent and scoped to the current user. Invitation acceptance and group updates link to the group; contribution events link to contribution history; payout events link to cycle history. Shared inbox URLs survive login.

The inbox contains delivered `IN_APP` records. Creating an invitation still only queues its external WhatsApp notification; no WhatsApp/SMS invitation message is sent automatically, and invitation creation does not yet create an inbox alert for the invited phone number. Share the invitation link manually. No database migration is needed for this slice.
