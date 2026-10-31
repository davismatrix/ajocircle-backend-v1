from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import AjoMember, PhoneVerificationAttempt, User
from app.services.phone_verification import ProviderUnavailable, VerificationResult, get_phone_provider
from test_v11_flow import auth


def register_raw(client, email, phone):
    response = client.post('/api/v1/auth/register', json={'first_name': 'Test', 'last_name': 'User', 'email': email,
        'phone_number': phone, 'password': 'safe-test-password-123'})
    assert response.status_code == 201, response.text
    return response.json()['access_token']


def start(client, token, phone):
    return client.post('/api/v1/auth/phone-verification/start', headers=auth(token), json={'phone_number': phone})


def check(client, token, attempt, code='123456'):
    return client.post('/api/v1/auth/phone-verification/check', headers=auth(token), json={'attempt_id': attempt, 'code': code})


def test_self_reported_number_does_not_authorize_invitation_and_verification_does(client):
    owner = register_raw(client, 'owner@example.com', '+14165550101')
    target = register_raw(client, 'target@example.com', '+1 (416) 555-0102')
    group = client.post('/api/v1/ajo-groups', headers=auth(owner), json={'name': 'Phone test', 'contribution_amount': '100', 'start_date': datetime.now(timezone.utc).date().isoformat()}).json()
    invitation = client.post(f'/api/v1/ajo-groups/{group["id"]}/invitations', headers=auth(owner), json={'phone_number': '+1 (416) 555-0102'}).json()
    accept = lambda: client.post('/api/v1/ajo-groups/invitations/accept', headers=auth(target), json={'token': invitation['token']})
    assert accept().status_code == 403
    assert client.get('/api/v1/auth/me', headers=auth(target)).json()['phone_verified'] is False
    response = start(client, target, '+1 (416) 555-0102')
    assert response.status_code == 200 and response.json()['phone_number'] == '+14165550102'
    attempt = response.json()['attempt_id']
    assert check(client, target, attempt, '000000').status_code == 400
    assert accept().status_code == 403
    verified = check(client, target, attempt)
    assert verified.status_code == 200 and verified.json()['phone_verified'] is True
    assert verified.json()['phone_number'] == '+14165550102'
    assert check(client, target, attempt).status_code == 200
    assert accept().status_code == 200


def test_claiming_same_number_does_not_reserve_it_and_only_one_verified_account_can_own_it(client):
    attacker = register_raw(client, 'attacker@example.com', '+14165550102')
    rightful = register_raw(client, 'rightful@example.com', '+14165550102')
    attempt = start(client, rightful, '+14165550102').json()['attempt_id']
    assert check(client, rightful, attempt).status_code == 200
    # Claimed but unverified numbers never authorize invitations or block registration.
    assert client.get('/api/v1/auth/me', headers=auth(attacker)).json()['phone_verified'] is False
    attacker_attempt = start(client, attacker, '+14165550102').json()['attempt_id']
    assert check(client, attacker, attacker_attempt).status_code == 409
    assert client.get('/api/v1/auth/me', headers=auth(attacker)).json()['phone_verified'] is False
    # Remove the unverified duplicate so the migration downgrade can safely restore the old unique column.
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == 'attacker@example.com'))
        user.claimed_phone_number = None
        db.commit()


def test_expiry_attempt_limit_resend_limit_and_attempt_owner(client):
    user = register_raw(client, 'user@example.com', '+14165550101')
    other = register_raw(client, 'other@example.com', '+14165550102')
    response = start(client, user, '+14165550101')
    attempt = response.json()['attempt_id']
    assert start(client, user, '+14165550101').status_code == 429
    assert check(client, other, attempt).status_code == 404
    for _ in range(5): assert check(client, user, attempt, '000000').status_code == 400
    assert check(client, user, attempt).status_code == 429
    assert client.get('/api/v1/auth/me', headers=auth(user)).json()['phone_verified'] is False
    expired = start(client, other, '+14165550102').json()['attempt_id']
    with SessionLocal() as db:
        db.get(PhoneVerificationAttempt, UUID(expired)).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert check(client, other, expired).status_code == 409


def test_configuration_and_provider_failures_fail_closed(client, monkeypatch):
    user = register_raw(client, 'user@example.com', '+14165550101')
    monkeypatch.setattr(settings, 'app_environment', 'production')
    with pytest.raises(ProviderUnavailable): get_phone_provider()
    assert start(client, user, '+14165550101').status_code == 503
    assert client.get('/api/v1/auth/me', headers=auth(user)).json()['phone_verified'] is False


def test_wrong_provider_destination_never_verifies(client, monkeypatch):
    class WrongDestination:
        def start(self, phone): return 'reference'
        def check(self, phone, reference, code): return VerificationResult('approved', '+14165559999')
    monkeypatch.setattr('app.api.phone_verification.get_phone_provider', lambda: WrongDestination())
    user = register_raw(client, 'user@example.com', '+14165550101')
    attempt = start(client, user, '+14165550101').json()['attempt_id']
    assert check(client, user, attempt).status_code == 400
    assert client.get('/api/v1/auth/me', headers=auth(user)).json()['phone_verified'] is False


def test_invalid_international_numbers_rejected(client):
    user = register_raw(client, 'user@example.com', None)
    for phone in ('4165550101', '+012345678', '+1abcdef123', '+123'):
        assert start(client, user, phone).status_code == 422


def test_concurrent_claims_allow_only_one_verified_account(client):
    first = register_raw(client, 'first@example.com', '+14165550109')
    second = register_raw(client, 'second@example.com', '+14165550109')
    first_id = start(client, first, '+14165550109').json()['attempt_id']
    second_id = start(client, second, '+14165550109').json()['attempt_id']
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda pair: check(client, *pair), [(first, first_id), (second, second_id)]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with SessionLocal() as db:
        users = db.scalars(select(User).where(User.email.in_(['first@example.com', 'second@example.com']))).all()
        assert sum(user.phone_verified for user in users) == 1
        # The old schema has a unique phone column, so an unverified duplicate cannot be restored on downgrade.
        for user in users:
            if not user.phone_verified: user.claimed_phone_number = None
        db.commit()


def test_firebase_provider_requires_verified_matching_phone(monkeypatch):
    import firebase_admin
    from firebase_admin import auth
    from app.services.phone_verification import FirebasePhoneProvider
    monkeypatch.setattr(firebase_admin, 'get_app', lambda name: object())
    claims = {'firebase': {'sign_in_provider': 'phone'}, 'phone_number': '+14165550101', 'auth_time': 1234}
    monkeypatch.setattr(auth, 'verify_id_token', lambda token, app: claims)
    provider = FirebasePhoneProvider('test-project')
    with pytest.raises(ProviderUnavailable): provider.start('+14165550101')
    assert provider.check('+14165550101', 'ref', 'token').status == 'approved'
    assert provider.check('+14165559999', 'ref', 'token').status == 'pending'
    claims['firebase']['sign_in_provider'] = 'password'
    assert provider.check('+14165550101', 'ref', 'token').status == 'pending'
    claims['firebase']['sign_in_provider'] = 'phone'
    claims['auth_time'] = None
    assert provider.check('+14165550101', 'ref', 'token').status == 'pending'
    claims['auth_time'] = int(datetime.now(timezone.utc).timestamp()) + 3600
    assert provider.check('+14165550101', 'ref', 'token').status == 'pending'
    with pytest.raises(ProviderUnavailable): FirebasePhoneProvider('')
    monkeypatch.setenv('FIREBASE_AUTH_EMULATOR_HOST', 'localhost:9099')
    with pytest.raises(ProviderUnavailable): FirebasePhoneProvider('test-project')


def test_firebase_rejects_stale_authentication(client, monkeypatch):
    class Provider:
        def start(self, phone): return 'ref'
        def check(self, phone, reference, token): return VerificationResult('approved', phone, 1)
    monkeypatch.setattr(settings, 'phone_verification_provider', 'FIREBASE')
    monkeypatch.setattr('app.api.phone_verification.get_phone_provider', lambda: Provider())
    token = register_raw(client, 'stale@example.com', '+14165550101')
    attempt = start(client, token, '+14165550101').json()['attempt_id']
    response = client.post('/api/v1/auth/phone-verification/check', headers=auth(token), json={'attempt_id': attempt, 'firebase_id_token': 'fake'})
    assert response.status_code == 400
    assert not client.get('/api/v1/auth/me', headers=auth(token)).json()['phone_verified']


def test_firebase_fresh_proof_verifies_only_matching_account(client, monkeypatch):
    class Provider:
        def start(self, phone): return 'reference'
        def check(self, phone, reference, token):
            return VerificationResult('approved', phone, int(datetime.now(timezone.utc).timestamp()))
    monkeypatch.setattr(settings, 'phone_verification_provider', 'FIREBASE')
    monkeypatch.setattr('app.api.phone_verification.get_phone_provider', lambda: Provider())
    user = register_raw(client, 'fresh@example.com', '+14165550101')
    other = register_raw(client, 'other@example.com', '+14165550102')
    attempt = start(client, user, '+14165550101').json()['attempt_id']
    payload = {'attempt_id': attempt, 'firebase_id_token': 'proof'}
    assert client.post('/api/v1/auth/phone-verification/check', headers=auth(other), json=payload).status_code == 404
    response = client.post('/api/v1/auth/phone-verification/check', headers=auth(user), json=payload)
    assert response.status_code == 200 and response.json()['phone_verified'] is True
    assert client.post('/api/v1/auth/phone-verification/check', headers=auth(user), json=payload).status_code == 200


def test_migration_keeps_legacy_self_reported_number_unverified(client):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text
    from uuid import uuid4
    from app.core.database import engine

    config = Config('alembic.ini')
    command.downgrade(config, '0003_group_creation_requests')
    user_id = uuid4()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id, email, first_name, last_name, password_hash, phone_number) VALUES (:id, 'legacy@example.com', 'Legacy', 'User', 'hash', '+14165550111')"), {'id': user_id})
    command.upgrade(config, 'head')
    with SessionLocal() as db:
        legacy = db.get(User, user_id)
        assert legacy.phone_number == '+14165550111'
        assert legacy.verified_phone_number is None and legacy.phone_verified is False
    claimant = register_raw(client, 'claimant@example.com', '+14165550111')
    attempt = start(client, claimant, '+14165550111').json()['attempt_id']
    assert check(client, claimant, attempt).status_code == 200
    with SessionLocal() as db:
        db.get(User, user_id).claimed_phone_number = None
        db.commit()


def test_phone_change_requires_new_approval_and_preserves_current_phone_on_failure(client):
    token = register_raw(client, 'person@example.com', '+14165550101')
    first = start(client, token, '+14165550101').json()['attempt_id']
    assert check(client, token, first).status_code == 200
    with SessionLocal() as db:
        db.get(PhoneVerificationAttempt, UUID(first)).created_at -= timedelta(seconds=61)
        db.commit()
    replacement = start(client, token, '+14165550102').json()['attempt_id']
    assert check(client, token, replacement, '000000').status_code == 400
    current = client.get('/api/v1/auth/me', headers=auth(token)).json()
    assert current['phone_verified'] is True and current['phone_number'] == '+14165550101'
    assert check(client, token, replacement).json()['phone_number'] == '+14165550102'


@pytest.mark.parametrize('limit', [2, 6])
def test_phone_send_limit_applies_across_accounts(client, monkeypatch, limit):
    monkeypatch.setattr(settings, 'phone_verification_requests_per_hour', limit)
    tokens = [register_raw(client, f'person{number}@example.com', None) for number in range(limit + 1)]
    for token in tokens[:limit]:
        assert start(client, token, '+14165550101').status_code == 200
    assert start(client, tokens[limit], '+14165550101').status_code == 429
