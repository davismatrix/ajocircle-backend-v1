from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import AjoInvitation, AjoMember, AuditLog, Notification
from test_integrity import account, create_group
from test_v11_flow import auth


def invite(client, owner, group_id, phone='+14165550002'):
    response = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner), json={'phone_number': phone})
    assert response.status_code == 201, response.text
    return response.json()


def accept(client, token, invitation_token):
    return client.post('/api/v1/ajo-groups/invitations/accept', headers=auth(token), json={'token': invitation_token})


def test_same_account_can_safely_retry_acceptance_after_response_loss_and_activation(client):
    owner, _ = account(client, 1)
    invitee, invitee_id = account(client, 2)
    wrong, _ = account(client, 3)
    group_id = create_group(client, owner)
    invitation = invite(client, owner, group_id)
    assert accept(client, wrong, invitation['token']).status_code == 403
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: accept(client, invitee, invitation['token']), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()['id'] == responses[1].json()['id']
    assert responses[0].json()['ajo_group_id'] == group_id
    assert accept(client, wrong, invitation['token']).status_code == 409
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    assert accept(client, invitee, invitation['token']).json()['ajo_group_id'] == group_id
    assert accept(client, wrong, invitation['token']).status_code == 409
    assert any(item['id'] == group_id for item in client.get('/api/v1/ajo-groups', headers=auth(invitee)).json())
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoMember).where(AjoMember.user_id == UUID(invitee_id))) == 1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == 'ACCEPT_INVITATION')) == 1
        assert db.scalar(select(func.count()).select_from(Notification).where(Notification.event_type == 'INVITATION_ACCEPTED')) == 1


def test_invalid_expired_cancelled_and_missing_invitation_are_rejected(client):
    owner, _ = account(client, 1)
    invitee, _ = account(client, 2)
    group_id = create_group(client, owner)
    assert accept(client, invitee, 'not-a-uuid').status_code == 422
    assert accept(client, invitee, str(uuid4())).status_code == 404
    expired = invite(client, owner, group_id)
    with SessionLocal() as db:
        db.get(AjoInvitation, UUID(expired['id'])).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert accept(client, invitee, expired['token']).status_code == 409
    cancelled = invite(client, owner, group_id)
    assert client.post(f'/api/v1/ajo-groups/{group_id}/invitations/{cancelled["id"]}/cancel', headers=auth(owner)).status_code == 200
    assert accept(client, invitee, cancelled['token']).status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoMember)) == 1


def test_owner_only_role_changes_are_enforced_by_server(client):
    owner, _ = account(client, 1)
    admin, admin_id = account(client, 2)
    member, member_id = account(client, 3)
    group_id = create_group(client, owner)
    for user_id, role in ((admin_id, 'ADMIN'), (member_id, 'MEMBER')):
        response = client.post(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(owner), json={'user_id': user_id, 'role': role})
        assert response.status_code == 201
        if role == 'MEMBER': member_record = response.json()['id']
    url = f'/api/v1/ajo-groups/{group_id}/members/{member_record}/role'
    assert client.patch(url, headers=auth(member), json={'role': 'TREASURER'}).status_code == 403
    assert client.patch(url, headers=auth(admin), json={'role': 'TREASURER'}).status_code == 403
    assert client.patch(url, headers=auth(owner), json={'role': 'TREASURER'}).status_code == 200
    assert client.get(f'/api/v1/ajo-groups/{group_id}/members', headers=auth(member)).status_code == 200
    assert client.post(f'/api/v1/ajo-groups/{group_id}/cancel', headers=auth(owner)).status_code == 200
    assert client.patch(url, headers=auth(owner), json={'role': 'MEMBER'}).status_code == 409
