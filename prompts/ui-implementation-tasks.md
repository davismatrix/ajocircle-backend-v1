# AjoCircle MVP UI implementation tasks

## 0. API readiness

- [x] Add `GET /api/v1/auth/me` returning the authenticated user's ID, name, email, phone number, and global role.
  - Acceptance: the frontend can restore the signed-in user after a page refresh without decoding the JWT.
- [x] Add `GET /api/v1/ajo-groups` returning the current user's groups and membership role.
  - Acceptance: a member can load a group list without knowing group IDs in advance.
- [x] Add `GET /api/v1/ajo-groups/{ajo_id}/members` for active group members.
  - Acceptance: owners/admins can select members when assigning roles or reviewing a group.
- [ ] Confirm the API response shapes in Swagger and publish them as frontend API types.
  - Acceptance: no UI screen depends on an undocumented response field.

## 1. Frontend foundation

- [x] Create the frontend application (recommended: Next.js + TypeScript).
- [x] Add server-side environment configuration for `API_URL` (replaces `NEXT_PUBLIC_API_URL`).
- [x] Create a typed API client with normalized API errors; the server-side proxy attaches the bearer token.
- [x] Add authentication state persistence and logout.
- [x] Create the base responsive layout: public layout, authenticated layout, navigation, loading, empty, and error states.
  - Acceptance: an unauthenticated user is redirected to login; API failures render an actionable message rather than a blank screen.

## 2. Authentication screens

- [x] Build registration form: first name, last name, email, phone number, password.
- [x] Build login form.
- [x] Replace the development-only browser token storage with an HttpOnly-cookie session strategy before production.
- [x] Display API validation failures, including the 72-byte password limit.
  - Acceptance: a new user can register, log out, and log back in from the UI.

## 3. Group discovery and creation

- [x] Build the “My Ajos” page using `GET /ajo-groups` once available.
- [x] Build the create-group form: name, description, contribution amount, frequency, payout type, start date, grace period, and late fee.
- [x] Add a group card with status, contribution amount, user role, and next action.
- [x] Add empty state for users who have not joined a group.
  - Acceptance: an owner can create a draft group and immediately navigate to it.
  - Delivered: `/dashboard` lists groups; `/dashboard/ajos/new` creates a draft; `/dashboard/ajos/{id}` shows a basic group overview. Late fees are fixed at zero to match backend support. Cycle details and group administration remain in subsequent slices.
- [x] Persist per-user creation request keys and recover uncertain submissions after reload.
- [x] Show description, grace period, and late fee in saved group overviews.
- [x] Define supported currencies and UTC start-date rules, with field-level validation errors.
- [x] Allow owner-only draft editing and confirmed cancellation, preserving audit records.
- [x] Test the live registration → creation/retry → overview → edit → list → cancellation flow against isolated FastAPI/PostgreSQL services on desktop and mobile.


## 4. Group dashboard

- [x] Build the group dashboard from `GET /ajo-groups/{ajo_id}/dashboard`.
- [x] Show group status, contribution amount/frequency, current cycle, next contribution, payout position, and recent activity.
- [x] Add role-aware actions: invite member, activate group, manage member role, submit contribution, or verify contribution.
- [x] Add predictable empty states for draft groups and groups with no current cycle.
  - Acceptance: members can understand their next required action without opening history pages.
  - Delivered: the dashboard supports activation, invitation token creation, owner role changes, contribution submission, and paginated review/verification for authorized roles. Invitation acceptance is covered in Slice 5; full history pages are covered in Slice 7.
- [x] Review the frozen payout order before activation; reject stale reviews and block activation while live invitations remain pending.
- [x] Recover pending invitation tokens after lost responses or reloads; allow authorized users to cancel invitations.
- [x] Reconcile uncertain contribution submissions and verification before retrying, including after a same-tab reload.

## 5. Invitations and members

- [x] Build the invite-member modal/form using `POST /ajo-groups/{ajo_id}/invitations`.
- [x] Present the returned invitation token/link in a copyable state until live WhatsApp sending is enabled.
- [x] Build the accept-invitation page using `POST /ajo-groups/invitations/accept`.
- [x] Build member list and owner-only role update controls after the members endpoint is available.
- [x] Enforce role-based visibility in the UI, while treating server-side authorization as authoritative.
  - Acceptance: an owner can invite a phone number; the invited account can accept; non-admin controls are not presented to ordinary members.
  - Delivered: invite links and token entry, same-tab continuation through login/registration, account switching, safe acceptance retry, and a member-visible roster with owner-only role controls. Phone ownership is verified through Firebase phone authentication over SMS before a new invitation can be accepted; configure Firebase in the frontend and backend environment.

- [x] Add invitation token/link copy buttons with a fallback when clipboard access is unavailable.
- [x] Reconcile uncertain member-role changes against the roster before allowing another update.
- [x] Reject invitations for existing members so unusable invitations cannot block activation.
- [x] Handle another invitation link in the same tab and warn when invitation-token storage is unavailable.

## 6. Contribution workflows

- [x] Build the contribution submission form from the dashboard schedule ID.
- [x] Capture amount, manual payment method, and payment reference.
- [x] Build the owner/admin/treasurer verification action for submitted contributions.
- [x] Add confirmation states and disable repeated submissions while requests are in flight.
  - Acceptance: a member can submit one contribution and an authorized user can verify it; the dashboard and history reflect the new status.
  - Delivered: fixed-amount payment entry, review/edit/confirm before recording a contribution, synchronous in-flight guards, and persistent confirmation notices. Uncertain submissions retain their original payment details; uncertain verification blocks other review actions until checked. Backend tests verify dashboard/history transitions, permissions, replay behavior, and a single ledger entry. Full history screens are covered in Slice 7.

## 7. History and records

- [x] Build contribution history with pagination, status badges, due dates, expected/paid amounts, and role-aware filtering.
- [x] Build cycle history with recipient, period, expected amount, and payout status.
- [x] Add URL query synchronization for page and filter state.
  - Acceptance: users can navigate historical records without client-side data loss and can share a filtered history URL.
  - Delivered: group contribution and cycle history pages with status/member filters, URL-based pagination and page size, exact decimal amounts, named recipients, payment details, loading/error/empty states, and recovery from invalid or out-of-range URLs. History APIs use typed response models and deterministic ordering; server-side membership and role checks enforce access.

## 8. Notification inbox

- [ ] Add a notification badge using `GET /notifications/unread-count`.
- [ ] Build the notifications page using `GET /notifications`.
- [ ] Mark an item read using `POST /notifications/{notification_id}/read`.
- [ ] Link actionable notifications to the relevant group or contribution screen.
  - Acceptance: invitation acceptance and contribution events appear in the member inbox and can be marked read.

## 9. Quality and delivery

- [ ] Add component tests for forms, empty states, permission-based actions, and API error display.
- [x] Add browser end-to-end coverage for register → create group → invite → accept → activate → submit → verify.
- [ ] Run accessibility checks for keyboard navigation, labels, focus handling, and error announcements.
- [ ] Add a frontend Dockerfile and Compose service only after local development is stable.
- [ ] Document local setup, environment variables, and deployment configuration.
  - Acceptance: CI runs unit and browser tests, and a new developer can run the UI against the backend from the README.

## Suggested delivery order

1. API readiness
2. Frontend foundation and authentication
3. Group creation and dashboard
4. Invitations and member management
5. Contributions and histories
6. Notifications
7. Quality, browser tests, and deployment

Payment screens and external payment-provider flows remain explicitly out of scope.
