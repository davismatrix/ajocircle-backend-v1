from datetime import datetime, timezone

from app.core.database import SessionLocal
from app.models import Notification


def register(client, *, first_name, last_name, email, phone_number):
    response = client.post("/api/v1/auth/register", json={
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone_number": phone_number,
        "password": "safe-test-password-123",
    })
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    if phone_number:
        started = client.post("/api/v1/auth/phone-verification/start", headers=auth(token), json={"phone_number": phone_number})
        assert started.status_code == 200, started.text
        checked = client.post("/api/v1/auth/phone-verification/check", headers=auth(token), json={"attempt_id": started.json()["attempt_id"], "code": "123456"})
        assert checked.status_code == 200, checked.text
    return token


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_v11_member_lifecycle(client):
    owner_token = register(client, first_name="Ada", last_name="Owner", email="ada@example.com", phone_number="+14165550101")
    member_token = register(client, first_name="Tunde", last_name="Member", email="tunde@example.com", phone_number="+14165550102")

    current_user = client.get("/api/v1/auth/me", headers=auth(owner_token))
    assert current_user.status_code == 200, current_user.text
    assert current_user.json()["email"] == "ada@example.com"

    group_response = client.post("/api/v1/ajo-groups", headers=auth(owner_token), json={
        "name": "Integration Test Circle",
        "contribution_amount": "10000.00",
        "frequency": "MONTHLY",
        "payout_type": "ROTATIONAL",
        "start_date": datetime.now(timezone.utc).date().isoformat(),
    })
    assert group_response.status_code == 201, group_response.text
    group_id = group_response.json()["id"]

    my_ajos = client.get("/api/v1/ajo-groups", headers=auth(owner_token))
    assert my_ajos.status_code == 200, my_ajos.text
    assert my_ajos.json()[0]["id"] == group_id
    assert my_ajos.json()[0]["membership_role"] == "OWNER"

    forbidden_invite = client.post(f"/api/v1/ajo-groups/{group_id}/invitations", headers=auth(member_token), json={"phone_number": "+14165550103"})
    assert forbidden_invite.status_code == 403

    invitation_response = client.post(f"/api/v1/ajo-groups/{group_id}/invitations", headers=auth(owner_token), json={
        "phone_number": "+14165550102",
        "role": "MEMBER",
    })
    assert invitation_response.status_code == 201, invitation_response.text
    invitation_token = invitation_response.json()["token"]

    accepted_response = client.post("/api/v1/ajo-groups/invitations/accept", headers=auth(member_token), json={"token": invitation_token})
    assert accepted_response.status_code == 200, accepted_response.text
    member_id = accepted_response.json()["id"]

    members = client.get(f"/api/v1/ajo-groups/{group_id}/members", headers=auth(member_token))
    assert members.status_code == 200, members.text
    assert {member["email"] for member in members.json()} == {"ada@example.com", "tunde@example.com"}

    role_response = client.patch(f"/api/v1/ajo-groups/{group_id}/members/{member_id}/role", headers=auth(owner_token), json={"role": "TREASURER"})
    assert role_response.status_code == 200, role_response.text
    assert role_response.json()["role"] == "TREASURER"

    activate_response = client.post(f"/api/v1/ajo-groups/{group_id}/activate", headers=auth(owner_token))
    assert activate_response.status_code == 200, activate_response.text

    dashboard_response = client.get(f"/api/v1/ajo-groups/{group_id}/dashboard", headers=auth(member_token))
    assert dashboard_response.status_code == 200, dashboard_response.text
    schedule_id = dashboard_response.json()["next_contribution"]["schedule_id"]

    submit_response = client.post(f"/api/v1/contributions/{schedule_id}/submit", headers=auth(member_token), json={
        "amount": "10000.00",
        "payment_method": "BANK_TRANSFER",
        "payment_reference": "TEST-001",
    })
    assert submit_response.status_code == 201, submit_response.text
    contribution_id = submit_response.json()["id"]

    verify_response = client.post(f"/api/v1/contributions/{contribution_id}/verify", headers=auth(owner_token))
    assert verify_response.status_code == 200, verify_response.text
    assert verify_response.json()["status"] == "VERIFIED"

    contribution_history = client.get(f"/api/v1/ajo-groups/{group_id}/contributions/history", headers=auth(member_token))
    assert contribution_history.status_code == 200, contribution_history.text
    assert contribution_history.json()["total"] == 4
    assert any(item["contribution_status"] == "VERIFIED" for item in contribution_history.json()["items"])

    cycle_history = client.get(f"/api/v1/ajo-groups/{group_id}/cycles/history", headers=auth(member_token))
    assert cycle_history.status_code == 200, cycle_history.text
    assert cycle_history.json()["total"] == 2

    notifications = client.get("/api/v1/notifications", headers=auth(member_token))
    assert notifications.status_code == 200, notifications.text
    events = {item["event_type"] for item in notifications.json()}
    assert {"INVITATION_ACCEPTED", "CONTRIBUTION_SUBMITTED", "CONTRIBUTION_VERIFIED"}.issubset(events)

    unread = client.get("/api/v1/notifications/unread-count", headers=auth(member_token))
    assert unread.status_code == 200
    assert unread.json()["count"] >= 3

    notification_id = notifications.json()[0]["id"]
    mark_read = client.post(f"/api/v1/notifications/{notification_id}/read", headers=auth(member_token))
    assert mark_read.status_code == 200, mark_read.text
    assert mark_read.json()["read_at"] is not None

    with SessionLocal() as db:
        invitation_outbox = db.query(Notification).filter_by(event_type="AJO_INVITATION", channel="WHATSAPP").one()
        assert invitation_outbox.status == "QUEUED"
        assert invitation_outbox.phone_number == "+14165550102"
