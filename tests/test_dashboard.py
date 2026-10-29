from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models import AjoCycle, ContributionSchedule
from test_integrity import account, create_group, submit
from test_v11_flow import auth


def test_dashboard_and_pending_contributions_are_role_scoped(client):
    owner, _ = account(client, 1)
    member, member_id = account(client, 2)
    outsider, _ = account(client, 3)
    group_id = create_group(client, owner, start_date=datetime.now(timezone.utc).date().isoformat())
    assert client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': member_id}).status_code == 201
    draft = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()
    assert draft['membership']['role'] == 'MEMBER'
    assert draft['next_contribution'] is None and draft['current_cycle'] is None
    assert client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(outsider)).status_code == 403
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    dashboard = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()
    assert dashboard['current_cycle']['cycle_number'] == 1
    assert Decimal(dashboard['next_contribution']['expected_amount']) == Decimal('100.00')
    response = submit(client, member, dashboard['next_contribution']['schedule_id'])
    assert response.status_code == 201
    contribution_id = response.json()['id']
    assert client.get(f'/api/v1/ajo-groups/{group_id}/contributions/pending', headers=auth(member)).status_code == 403
    assert client.get(f'/api/v1/ajo-groups/{group_id}/contributions/pending', headers=auth(outsider)).status_code == 403
    member_record = client.get(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner)).json()
    member_record = next(item for item in member_record if item['user_id'] == member_id)
    assert client.patch(f'/api/v1/ajo-groups/{group_id}/members/{member_record["id"]}/role', headers=auth(owner), json={'role': 'TREASURER'}).status_code == 200
    assert client.get(f'/api/v1/ajo-groups/{group_id}/contributions/pending', headers=auth(member)).status_code == 200
    pending = client.get(f'/api/v1/ajo-groups/{group_id}/contributions/pending?page_size=1', headers=auth(owner)).json()
    assert pending['total'] == 1 and len(pending['items']) == 1
    item = pending['items'][0]
    assert item['contribution_id'] == contribution_id
    assert item['first_name'] == 'Test' and item['payment_reference'] == 'TEST'
    assert client.post(f'/api/v1/contributions/{contribution_id}/verify', headers=auth(owner)).status_code == 200
    assert client.get(f'/api/v1/ajo-groups/{group_id}/contributions/pending', headers=auth(owner)).json()['total'] == 0
    updated = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()
    assert updated['next_contribution']['schedule_id'] != dashboard['next_contribution']['schedule_id']
    assert any(item['action'] == 'VERIFY_CONTRIBUTION' for item in updated['recent_activity'])


def test_dashboard_with_no_current_cycle(client):
    owner, _ = account(client, 1)
    group_id = create_group(client, owner, start_date='2100-01-31')
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    dashboard = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(owner)).json()
    assert dashboard['current_cycle'] is None
    assert dashboard['next_contribution']['due_date'] == '2100-01-31'
