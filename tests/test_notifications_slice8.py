from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import UUID

from app.core.database import SessionLocal
from app.services.notifications import notify
from test_integrity import account, create_group, submit
from test_v11_flow import auth


def seed(user_id, **options):
    with SessionLocal() as db:
        item = notify(db, user_id=UUID(user_id), event_type='TEST', title='Test update', body='An update', **options)
        item.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.commit(); db.refresh(item)
        return str(item.id)


def test_inbox_is_user_scoped_paginated_and_excludes_external_outbox(client):
    user, user_id = account(client, 1)
    other, other_id = account(client, 2)
    own = [seed(user_id), seed(user_id)]
    seed(other_id)
    queued = seed(user_id, channel='WHATSAPP', payload={'invitation_token': 'private-token'})
    url = '/api/v1/notifications'
    response = client.get(url, headers=auth(user))
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert [item['id'] for item in response.json()] == sorted(own, reverse=True)
    assert 'private-token' not in response.text
    assert client.get(f'{url}/unread-count', headers=auth(user)).json()['count'] == 2
    assert client.get(f'{url}/unread-count', headers=auth(other)).json()['count'] == 1
    first = client.get(f'{url}?limit=1', headers=auth(user)).json()
    second = client.get(f'{url}?limit=1&offset=1', headers=auth(user)).json()
    assert first[0]['id'] != second[0]['id']
    assert client.get(f'{url}?offset=2', headers=auth(user)).json() == []
    assert client.post(f'{url}/{queued}/read', headers=auth(user)).status_code == 404
    assert client.post(f'{url}/{own[0]}/read', headers=auth(other)).status_code == 404
    assert client.post(f'{url}/not-a-uuid/read', headers=auth(user)).status_code == 422
    assert client.get(f'{url}?offset=-1', headers=auth(user)).status_code == 422


def test_mark_read_is_idempotent_and_count_tracks_concurrent_retries(client):
    user, user_id = account(client, 1)
    notification_id = seed(user_id)
    url = f'/api/v1/notifications/{notification_id}/read'
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(url, headers=auth(user)), range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json()['read_at'] == responses[1].json()['read_at']
    assert client.post(url, headers=auth(user)).json()['read_at'] == responses[0].json()['read_at']
    assert client.get('/api/v1/notifications/unread-count', headers=auth(user)).json()['count'] == 0
    assert client.get('/api/v1/notifications?unread_only=true', headers=auth(user)).json() == []
    assert len(client.get('/api/v1/notifications', headers=auth(user)).json()) == 1


def test_invitation_acceptance_and_contribution_events_reach_member_inbox(client):
    owner, _ = account(client, 1)
    member, _ = account(client, 2)
    group_id = create_group(client, owner)
    invitation = client.post(f'/api/v1/ajo-groups/{group_id}/invitations', headers=auth(owner), json={'phone_number': '+14165550002'}).json()
    assert client.get('/api/v1/notifications/unread-count', headers=auth(member)).json()['count'] == 0
    accepted = client.post('/api/v1/ajo-groups/invitations/accept', headers=auth(member), json={'token': invitation['token']})
    assert accepted.status_code == 200
    assert client.post(f'/api/v1/ajo-groups/{group_id}/activate', headers=auth(owner)).status_code == 200
    schedule = client.get(f'/api/v1/ajo-groups/{group_id}/dashboard', headers=auth(member)).json()['next_contribution']
    contribution = submit(client, member, schedule['schedule_id'])
    assert contribution.status_code == 201
    assert client.post(f'/api/v1/contributions/{contribution.json()["id"]}/verify', headers=auth(owner)).status_code == 200
    items = client.get('/api/v1/notifications', headers=auth(member)).json()
    assert {item['event_type'] for item in items} == {'INVITATION_ACCEPTED', 'CONTRIBUTION_SUBMITTED', 'CONTRIBUTION_VERIFIED'}
    assert all(item['ajo_group_id'] == group_id for item in items)
    assert client.get('/api/v1/notifications/unread-count', headers=auth(member)).json()['count'] == 3
    for item in items:
        assert client.post(f'/api/v1/notifications/{item["id"]}/read', headers=auth(member)).status_code == 200
    assert client.get('/api/v1/notifications?unread_only=true', headers=auth(member)).json() == []
