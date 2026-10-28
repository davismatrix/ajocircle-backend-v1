from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os
import subprocess
import sys
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import AjoCycle, Contribution, ContributionSchedule, FinancialLedger, Payout
from test_v11_flow import auth, register


def account(client, number):
    token = register(client, first_name='Test', last_name='Member',
                     email=f'member{number}@example.com', phone_number=f'+14165550{number:03}')
    user_id = client.get('/api/v1/auth/me', headers=auth(token)).json()['id']
    return token, user_id


def create_group(client, token, **options):
    payload = {'name': 'Integrity Circle', 'contribution_amount': '100.00',
               'start_date': datetime.now(timezone.utc).date().isoformat(), **options}
    response = client.post('/api/v1/ajo-groups', headers=auth(token), json=payload)
    assert response.status_code == 201, response.text
    return response.json()['id']


@pytest.fixture
def active_group(client):
    owner, _ = account(client, 1)
    member, member_id = account(client, 2)
    group_id = create_group(client, owner, currency='USD')
    response = client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner),
                           json={'user_id': member_id})
    assert response.status_code == 201, response.text
    response = client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner))
    assert response.status_code == 200, response.text
    history = client.get(f'/api/v1/ajo-groups/{group_id}/cycles/history', headers=auth(owner)).json()
    first_cycle = next(item for item in history['items'] if item['cycle_number'] == 1)
    return owner, member, group_id, first_cycle


def submit(client, token, schedule_id, amount='100.00'):
    return client.post(f'/api/v1/contributions/{schedule_id}/submit', headers=auth(token),
                       json={'amount': amount, 'payment_method': 'BANK_TRANSFER', 'payment_reference': 'TEST'})


def payout(client, token, payout_id, amount='200.00'):
    return client.post(f'/api/v1/payouts/{payout_id}/mark-paid', headers=auth(token),
                       json={'actual_amount': amount, 'payment_method': 'BANK_TRANSFER', 'payment_reference': 'PAYOUT'})


def fund_cycle(client, owner, member, group_id):
    ids = []
    for token in (owner, member):
        schedule = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(token)).json()['next_contribution']
        response = submit(client, token, schedule['schedule_id'])
        assert response.status_code == 201, response.text
        contribution_id = response.json()['id']
        response = client.post(f'/api/v1/contributions/{contribution_id}/verify', headers=auth(owner))
        assert response.status_code == 200, response.text
        ids.append(contribution_id)
    return ids


def test_full_amount_funding_currency_and_repeated_actions(client, active_group):
    owner, member, group_id, cycle = active_group
    schedule = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()['next_contribution']
    assert submit(client, member, schedule['schedule_id'], '50.00').status_code == 400
    assert submit(client, member, schedule['schedule_id'], '101.00').status_code == 400
    assert payout(client, owner, cycle['payout_id'], '100.00').status_code == 400
    assert payout(client, owner, cycle['payout_id']).status_code == 409
    assert payout(client, member, cycle['payout_id']).status_code == 403
    contribution_ids = fund_cycle(client, owner, member, group_id)
    assert submit(client, member, schedule['schedule_id']).status_code == 409
    assert client.post(f'/api/v1/contributions/{contribution_ids[0]}/verify', headers=auth(owner)).status_code == 409
    assert payout(client, owner, cycle['payout_id']).status_code == 200
    assert payout(client, owner, cycle['payout_id']).status_code == 409
    with SessionLocal() as db:
        entries = db.scalars(select(FinancialLedger).where(FinancialLedger.ajo_group_id == UUID(group_id))).all()
        assert len(entries) == 3
        assert {entry.currency for entry in entries} == {'USD'}
        assert sum(entry.amount for entry in entries) == Decimal('0.00')
        assert db.get(AjoCycle, UUID(cycle['cycle_id'])).status == 'PAID'


def test_membership_freezes_on_activation(client):
    owner, _ = account(client, 1)
    invitee, invitee_id = account(client, 2)
    group_id = create_group(client, owner)
    invitation = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner),
                             json={'phone_number': '+14165550002'}).json()
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 409
    assert client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner),
                       json={'user_id': invitee_id}).status_code == 409
    assert client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner),
                       json={'phone_number': '+14165550003'}).status_code == 409
    assert client.post('/api/v1/ajo-groups/invitations/accept', headers=auth(invitee),
                       json={'token': invitation['token']}).status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoCycle)) == 1


@pytest.mark.parametrize('frequency,second_start', [('DAILY', date(2100, 2, 1)),
                                                   ('WEEKLY', date(2100, 2, 7)),
                                                   ('MONTHLY', date(2100, 2, 28))])
def test_frequency_and_grace_period(client, frequency, second_start):
    owner, _ = account(client, 1)
    _, member_id = account(client, 2)
    group_id = create_group(client, owner, frequency=frequency.lower(), grace_period_days=2, start_date="2100-01-31")
    client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': member_id})
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    with SessionLocal() as db:
        cycles = db.scalars(select(AjoCycle).order_by(AjoCycle.cycle_number)).all()
        assert cycles[1].period_start == second_start
        assert cycles[0].period_end == second_start - timedelta(days=1)
        for cycle in cycles:
            schedules = db.scalars(select(ContributionSchedule).where(ContributionSchedule.ajo_cycle_id == cycle.id)).all()
            assert len(schedules) == 2
            assert all(schedule.due_date == cycle.period_start + timedelta(days=2) for schedule in schedules)


@pytest.mark.parametrize('options', [{'frequency': 'YEARLY'}, {'payout_type': 'RANDOM'},
                                      {'late_fee': '10.00'}, {'contribution_amount': '1.001'},
                                      {'currency': '123'}])
def test_unsupported_options_are_rejected(client, options):
    owner, _ = account(client, 1)
    response = client.post('/api/v1/ajo-groups', headers=auth(owner), json={
        'name': 'Invalid Circle', 'contribution_amount': '100.00', 'start_date': '2026-01-31', **options})
    assert response.status_code == 422, response.text


def test_concurrent_submissions_and_verifications(client, active_group):
    owner, member, group_id, _ = active_group
    schedule_id = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()['next_contribution']['schedule_id']
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: submit(client, member, schedule_id), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    contribution_id = next(response.json()['id'] for response in responses if response.status_code == 201)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(
            f'/api/v1/contributions/{contribution_id}/verify', headers=auth(owner)), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(FinancialLedger)) == 1


def test_concurrent_payouts_create_one_ledger_entry(client, active_group):
    owner, member, group_id, cycle = active_group
    fund_cycle(client, owner, member, group_id)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: payout(client, owner, cycle['payout_id']), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(FinancialLedger).where(FinancialLedger.transaction_type == 'PAYOUT')) == 1


def test_legacy_partial_contribution_cannot_be_verified(client, active_group):
    owner, member, group_id, _ = active_group
    schedule_id = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()['next_contribution']['schedule_id']
    contribution_id = submit(client, member, schedule_id).json()['id']
    with SessionLocal() as db:
        db.get(Contribution, UUID(contribution_id)).paid_amount = Decimal('50.00')
        db.commit()
    assert client.post(f'/api/v1/contributions/{contribution_id}/verify', headers=auth(owner)).status_code == 409


@pytest.mark.parametrize("test_url", [None, "postgresql+psycopg://localhost/ajocircle"])
def test_database_guard_rejects_implicit_or_non_test_database(test_url):
    env = os.environ.copy()
    env.pop("TEST_DATABASE_URL", None)
    if test_url:
        env["TEST_DATABASE_URL"] = test_url
    result = subprocess.run([sys.executable, "tests/conftest.py"], env=env,
                            capture_output=True, text=True)
    assert result.returncode != 0
    assert "Tests require TEST_DATABASE_URL" in result.stderr


def test_concurrent_activation_generates_one_rotation(client):
    owner, _ = account(client, 1)
    group_id = create_group(client, owner)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(
            f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoCycle)) == 1
        assert db.scalar(select(func.count()).select_from(Payout)) == 1
        assert db.scalar(select(func.count()).select_from(ContributionSchedule)) == 1


def test_invitation_acceptance_and_activation_keep_roster_consistent(client):
    owner, _ = account(client, 1)
    member, _ = account(client, 2)
    group_id = create_group(client, owner)
    invitation = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner),
                             json={'phone_number': '+14165550002'}).json()
    with ThreadPoolExecutor(max_workers=2) as executor:
        activation = executor.submit(client.post, f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner))
        acceptance = executor.submit(client.post, '/api/v1/ajo-groups/invitations/accept',
                                     headers=auth(member), json={'token': invitation['token']})
        assert activation.result().status_code == 200
        accepted_status = acceptance.result().status_code
        assert accepted_status in (200, 409)
    expected_members = 2 if accepted_status == 200 else 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoCycle)) == expected_members
        assert db.scalar(select(func.count()).select_from(ContributionSchedule)) == expected_members ** 2
