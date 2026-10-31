from uuid import UUID

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import AuditLog, Contribution, FinancialLedger
from test_integrity import active_group, account
from test_v11_flow import auth


def test_submission_confirmation_history_and_verification_integrity(client, active_group):
    owner, member, group_id, _ = active_group
    outsider, _ = account(client, 3)
    dashboard_url = f'/api/v1/ajo-groups/{group_id}/dashboard'
    schedule = client.get(dashboard_url, headers=auth(member)).json()['next_contribution']
    url = f'/api/v1/contributions/{schedule["schedule_id"]}/submit'
    payload = {'amount': schedule['expected_amount'], 'payment_method': ' Bank transfer ', 'payment_reference': ' REF-SLICE6 '}
    for invalid in ({**payload, 'payment_method': '  '}, {**payload, 'payment_reference': '  '}):
        assert client.post(url, headers=auth(member), json=invalid).status_code == 422
    assert client.post(url, headers=auth(outsider), json=payload).status_code == 403
    result = client.post(url, headers=auth(member), json=payload)
    assert result.status_code == 201
    assert result.json()['payment_method'] == 'Bank transfer'
    assert result.json()['payment_reference'] == 'REF-SLICE6'
    assert client.post(url, headers=auth(member), json=payload).status_code == 200
    assert client.post(url, headers=auth(member), json={**payload, 'payment_reference': 'DIFFERENT'}).status_code == 409
    assert client.get(dashboard_url, headers=auth(member)).json()['next_contribution']['status'] == 'SUBMITTED'
    history_url = f'/api/v1/ajo-groups/{group_id}/contributions/history'
    history = client.get(history_url, headers=auth(member)).json()['items']
    row = next(item for item in history if item['schedule_id'] == schedule['schedule_id'])
    assert row['contribution_status'] == 'SUBMITTED'
    contribution_id = result.json()['id']
    verify_url = f'/api/v1/contributions/{contribution_id}/verify'
    assert client.post(verify_url, headers=auth(member)).status_code == 403
    assert client.post(verify_url, headers=auth(outsider)).status_code == 403
    assert client.post(verify_url, headers=auth(owner)).status_code == 200
    assert client.post(verify_url, headers=auth(owner)).status_code == 409
    history = client.get(history_url, headers=auth(member)).json()['items']
    row = next(item for item in history if item['schedule_id'] == schedule['schedule_id'])
    assert row['schedule_status'] == 'PAID' and row['contribution_status'] == 'VERIFIED'
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Contribution).where(Contribution.id == UUID(contribution_id))) == 1
        assert db.scalar(select(func.count()).select_from(FinancialLedger).where(FinancialLedger.reference_id == UUID(contribution_id))) == 1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.entity_id == UUID(contribution_id), AuditLog.action == 'VERIFY_CONTRIBUTION')) == 1
