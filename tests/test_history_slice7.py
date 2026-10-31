from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.database import SessionLocal
from app.models import ContributionSchedule
from test_integrity import active_group, account, create_group, payout, submit
from test_v11_flow import auth


def test_history_visibility_filters_and_decimal_precision(client, active_group):
    owner, member, group_id, _ = active_group
    root = f'/api/v1/ajo-groups/{group_id}'
    membership = client.get(f'{root}/dashboard', headers=auth(member)).json()['membership']['id']
    owner_membership = client.get(f'{root}/dashboard', headers=auth(owner)).json()['membership']['id']
    own = client.get(f'{root}/contributions/history', headers=auth(member)).json()
    assert own['total'] == 2 and {item['member_id'] for item in own['items']} == {membership}
    assert client.get(f'{root}/contributions/history?member_id={owner_membership}', headers=auth(member)).status_code == 403
    assert client.get(f'{root}/contributions/history?member_id={membership}', headers=auth(owner)).json()['total'] == 2
    with SessionLocal() as db:
        schedule = db.get(ContributionSchedule, UUID(own['items'][0]['schedule_id']))
        schedule.expected_amount = Decimal('9007199254740991.99')
        db.commit()
    item = client.get(f'{root}/contributions/history?status=EXPECTED', headers=auth(member)).json()['items'][0]
    assert item['expected_amount'] == '9007199254740991.99'
    assert item['paid_amount'] is None and item['first_name'] == 'Test'
    outsider, _ = account(client, 3)
    for path in ('contributions/history', 'cycles/history'):
        assert client.get(f'{root}/{path}', headers=auth(outsider)).status_code == 403
    foreign_group = create_group(client, outsider)
    foreign_member = client.get(f'/api/v1/ajo-groups/{foreign_group}/dashboard', headers=auth(outsider)).json()['membership']['id']
    assert client.get(f'{root}/contributions/history?member_id={foreign_member}', headers=auth(owner)).status_code == 404


def test_history_pagination_has_deterministic_ties_and_validates_filters(client, active_group):
    owner, _, group_id, _ = active_group
    root = f'/api/v1/ajo-groups/{group_id}'
    records = [client.get(f'{root}/contributions/history?page={page}&page_size=1', headers=auth(owner)).json() for page in range(1, 5)]
    ids = [record['items'][0]['schedule_id'] for record in records]
    assert len(set(ids)) == 4
    assert all(record['total'] == 4 for record in records)
    assert client.get(f'{root}/contributions/history?page=5&page_size=1', headers=auth(owner)).json()['items'] == []
    repeat = client.get(f'{root}/contributions/history?page_size=100', headers=auth(owner)).json()
    assert [item['schedule_id'] for item in repeat['items']] == ids
    for query in ('status=INVALID', 'page=0', 'page_size=101', 'member_id=bad'):
        assert client.get(f'{root}/contributions/history?{query}', headers=auth(owner)).status_code == 422
    assert client.get(f'{root}/cycles/history?payout_status=INVALID', headers=auth(owner)).status_code == 422


@pytest.mark.parametrize('role', ['ADMIN', 'TREASURER'])
def test_history_group_review_roles(client, active_group, role):
    owner, member, group_id, _ = active_group
    root = f'/api/v1/ajo-groups/{group_id}'
    membership = client.get(f'{root}/dashboard', headers=auth(member)).json()['membership']['id']
    assert client.patch(f'{root}/members/{membership}/role', headers=auth(owner), json={'role': role}).status_code == 200
    assert client.get(f'{root}/contributions/history', headers=auth(member)).json()['total'] == 4


def test_history_tracks_submission_verification_and_paid_cycle_recipient(client, active_group):
    owner, member, group_id, first_cycle = active_group
    root = f'/api/v1/ajo-groups/{group_id}'
    schedule = client.get(f'{root}/dashboard', headers=auth(member)).json()['next_contribution']
    result = submit(client, member, schedule['schedule_id'])
    assert result.status_code == 201
    submitted = client.get(f'{root}/contributions/history?status=SUBMITTED', headers=auth(member)).json()
    assert submitted['total'] == 1 and submitted['items'][0]['payment_reference'] == 'TEST'
    assert client.post(f'/api/v1/contributions/{result.json()["id"]}/verify', headers=auth(owner)).status_code == 200
    verified = client.get(f'{root}/contributions/history?status=VERIFIED', headers=auth(member)).json()
    assert verified['total'] == 1 and verified['items'][0]['verified_at']
    owner_schedule = client.get(f'{root}/dashboard', headers=auth(owner)).json()['next_contribution']
    owner_result = submit(client, owner, owner_schedule['schedule_id'])
    assert owner_result.status_code == 201
    assert client.post(f'/api/v1/contributions/{owner_result.json()["id"]}/verify', headers=auth(owner)).status_code == 200
    assert payout(client, owner, first_cycle['payout_id']).status_code == 200
    paid = client.get(f'{root}/cycles/history?payout_status=PAID', headers=auth(member)).json()
    assert paid['total'] == 1
    item = paid['items'][0]
    assert item['recipient_member_id'] and item['recipient_first_name'] == 'Test'
    assert item['actual_amount'] == '200.00' and item['paid_at']
    assert client.get(f'{root}/cycles/history?payout_status=PENDING', headers=auth(member)).json()['total'] == 1
