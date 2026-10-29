from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import AjoCycle, AuditLog, Contribution, FinancialLedger, Notification
from test_integrity import account, active_group, create_group, submit
from test_v11_flow import auth


def test_invitation_recovery_preview_and_safe_activation(client):
    owner, _ = account(client, 1)
    admin, admin_id = account(client, 2)
    member, member_id = account(client, 3)
    group_id = create_group(client, owner)
    client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': admin_id, 'role': 'ADMIN'})
    client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': member_id, 'role': 'MEMBER'})
    invite = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner), json={'phone_number': '+14165550003'}).json()
    assert client.get(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(member)).status_code == 403
    found = client.get(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(admin)).json()
    assert found['total'] == 1 and found['items'][0]['token'] == invite['token']
    preview = client.get(f'/api/v1/ajo-groups/{group_id}/activation-preview', headers=auth(admin)).json()
    assert preview['pending_invitations'] == 1
    assert len(preview['members']) == 3 and preview['members'][0]['payout_position'] == 1
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner), json={'preview_hash': preview['preview_hash']}).status_code == 409
    assert client.post(f'/api/v1/ajo-groups/{group_id}/invitations/{invite["id"]}/cancel', headers=auth(member)).status_code == 403
    assert client.post(f'/api/v1/ajo-groups/{group_id}/invitations/{invite["id"]}/cancel', headers=auth(admin)).status_code == 200
    assert client.post(f'/api/v1/ajo-groups/{group_id}/invitations/{invite["id"]}/cancel', headers=auth(admin)).status_code == 200
    assert client.get(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(admin)).json()['total'] == 0
    # A stale review cannot silently approve a changed roster or group settings.
    third_token, third_id = account(client, 4)
    assert client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': third_id}).status_code == 201
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner), json={'preview_hash': preview['preview_hash']}).status_code == 409
    preview = client.get(f'/api/v1/ajo-groups/{group_id}/activation-preview', headers=auth(owner)).json()
    assert [m['payout_position'] for m in preview['members']] == [1, 2, 3, 4]
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner), json={'preview_hash': preview['preview_hash']}).status_code == 200
    with SessionLocal() as db:
        notifications = db.scalars(select(Notification).where(Notification.event_type == 'AJO_INVITATION')).all()
        assert notifications[0].status == 'CANCELLED'
        cycles = db.scalars(select(AjoCycle).order_by(AjoCycle.cycle_number)).all()
        assert [str(cycle.payout_recipient_id) for cycle in cycles] == [m['member_id'] for m in preview['members']]


def test_expired_invitation_does_not_block_activation(client):
    from app.models import AjoInvitation
    owner, _ = account(client, 1)
    group_id = create_group(client, owner)
    invitation = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner), json={'phone_number': '+14165550003'}).json()
    with SessionLocal() as db:
        db.get(AjoInvitation, UUID(invitation['id'])).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert client.get(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner)).json()['total'] == 0
    assert client.get(f'/api/v1/ajo-groups/{group_id}/activation-preview', headers=auth(owner)).json()['pending_invitations'] == 0
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200


def test_payment_replay_and_authorized_status_reconciliation(client, active_group):
    owner, member, group_id, cycle = active_group
    outsider, _ = account(client, 3)
    dashboard = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()
    schedule = dashboard['next_contribution']['schedule_id']
    assert client.get(f'/api/v1/contributions/schedules/{schedule}/status', headers=auth(outsider)).status_code == 403
    assert client.get(f'/api/v1/contributions/schedules/{schedule}/status', headers=auth(member)).json()['contribution_status'] is None
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: submit(client, member, schedule), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 201]
    contribution_id = responses[0].json()['id']
    assert responses[1].json()['id'] == contribution_id
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(outsider)).status_code == 403
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(owner)).json()['contribution_status'] == 'SUBMITTED'
    assert client.post(f'/api/v1/contributions/{schedule}/submit', headers=auth(member), json={'amount': '100.00', 'payment_method': 'BANK_TRANSFER', 'payment_reference': 'DIFFERENT'}).status_code == 409
    assert client.post(f'/api/v1/contributions/{contribution_id}/verify', headers=auth(owner)).status_code == 200
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(owner)).json()['contribution_status'] == 'VERIFIED'
    assert submit(client, member, schedule).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Contribution)) == 1
        assert db.scalar(select(func.count()).select_from(FinancialLedger)) == 1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == 'SUBMIT_CONTRIBUTION')) == 1


def test_invitation_creation_and_activation_cannot_strand_an_invitee(client):
    owner, _ = account(client, 1)
    group_id = create_group(client, owner)
    with ThreadPoolExecutor(max_workers=2) as executor:
        invitation = executor.submit(client.post, f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner), json={'phone_number': '+14165550003'})
        activation = executor.submit(client.post, f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner))
        invite_status = invitation.result().status_code
        activate_status = activation.result().status_code
    assert (invite_status, activate_status) in {(201, 409), (409, 200)}
    if invite_status == 201:
        assert client.get(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner)).json()['total'] == 1
        assert client.get(f'/api/v1/ajo-groups/{group_id}', headers=auth(owner)).json()['status'] == 'DRAFT'
    else:
        assert client.get(f'/api/v1/ajo-groups/{group_id}', headers=auth(owner)).json()['status'] == 'ACTIVE'


def test_status_is_hidden_from_other_ordinary_members(client):
    owner, _ = account(client, 1)
    member, member_id = account(client, 2)
    other, other_id = account(client, 3)
    group_id = create_group(client, owner)
    for user_id in (member_id, other_id):
        assert client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': user_id}).status_code == 201
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    schedule = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()['next_contribution']['schedule_id']
    contribution_id = submit(client, member, schedule).json()['id']
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(other)).status_code == 403
    assert client.get(f'/api/v1/contributions/schedules/{schedule}/status', headers=auth(other)).status_code == 403
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(member)).status_code == 200
    assert client.get(f'/api/v1/contributions/{contribution_id}/status', headers=auth(owner)).status_code == 200
