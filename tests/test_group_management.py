from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal
from app.models import AjoCreationRequest, AjoGroup, AjoInvitation, AuditLog, Notification
from test_integrity import account
from test_v11_flow import auth


def settings(**changes):
    return {"name": "Family savings", "description": "Family circle", "currency": "CAD",
            "contribution_amount": "100.00", "frequency": "MONTHLY", "payout_type": "ROTATIONAL",
            "start_date": datetime.now(timezone.utc).date().isoformat(),
            "grace_period_days": 2, "late_fee": "0", **changes}


def create(client, token, key=None, **changes):
    headers = auth(token)
    if key:
        headers["Idempotency-Key"] = str(key)
    return client.post("/api/v1/ajo-groups", headers=headers, json=settings(**changes))


def test_concurrent_creation_replay_and_key_conflicts(client):
    owner, _ = account(client, 1)
    key = uuid4()
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: create(client, owner, key), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert create(client, owner, key, contribution_amount="100").status_code == 200
    assert create(client, owner, key, name="Different circle").status_code == 409
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AjoGroup)) == 1
        assert db.scalar(select(func.count()).select_from(AjoCreationRequest)) == 1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "CREATE_AJO")) == 1
    another, _ = account(client, 2)
    assert create(client, another, key).status_code == 201


def test_replay_after_midnight_does_not_reject_original_request(client, monkeypatch):
    owner, _ = account(client, 1)
    key = uuid4()
    payload = settings()
    original = client.post("/api/v1/ajo-groups", headers={**auth(owner), "Idempotency-Key": str(key)}, json=payload)
    class Tomorrow(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(days=1)
    monkeypatch.setattr("app.api.ajo.datetime", Tomorrow)
    retry = client.post("/api/v1/ajo-groups", headers={**auth(owner), "Idempotency-Key": str(key)}, json=payload)
    assert retry.status_code == 200
    assert retry.json()["id"] == original.json()["id"]
    assert client.post("/api/v1/ajo-groups", headers=auth(owner), json=payload).status_code == 422


@pytest.mark.parametrize("changes,field", [({"currency": "XYZ"}, "currency"),
    ({"start_date": "2020-01-01"}, "start_date"), ({"name": "  "}, "name"),
    ({"description": "x" * 2001}, "description"), ({"grace_period_days": 366}, "grace_period_days"), ({"contribution_amount": "1.001"}, "contribution_amount")])
def test_validation_returns_field_locations(client, changes, field):
    owner, _ = account(client, 1)
    response = create(client, owner, **changes)
    assert response.status_code == 422, response.text
    assert any(error["loc"] == ["body", field] for error in response.json()["detail"])


def test_details_edit_cancel_and_permissions(client):
    owner, _ = account(client, 1)
    member, member_id = account(client, 2)
    key = uuid4()
    group = create(client, owner, key).json()
    group_id = group["id"]
    assert group["description"] == "Family circle"
    assert group["grace_period_days"] == 2
    assert group["late_fee"] == "0.00"
    assert client.get(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner)).json() == group
    assert client.get("/api/v1/ajo-groups", headers=auth(owner)).json()[0]["description"] == "Family circle"
    client.post(f"/api/v1/ajo-groups/{group_id}/members", headers=auth(owner), json={"user_id": member_id, "role": "ADMIN"})
    assert client.patch(f"/api/v1/ajo-groups/{group_id}", headers=auth(member), json=settings()).status_code == 403
    assert client.post(f"/api/v1/ajo-groups/{group_id}/cancel", headers=auth(member)).status_code == 403
    response = client.patch(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner), json=settings(name="Updated circle", grace_period_days=3))
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Updated circle"
    assert response.json()["grace_period_days"] == 3
    assert client.patch(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner), json=settings(name="Updated circle", grace_period_days=3, contribution_amount="100")).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "UPDATE_AJO")) == 1
    # Replaying a creation never undoes subsequent edits.
    assert create(client, owner, key).json()["name"] == "Updated circle"
    client.post(f"/api/v1/ajo-groups/{group_id}/invitations", headers=auth(owner), json={"phone_number": "+14165550003"})
    response = client.post(f"/api/v1/ajo-groups/{group_id}/cancel", headers=auth(owner))
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"
    assert client.post(f"/api/v1/ajo-groups/{group_id}/cancel", headers=auth(owner)).status_code == 200
    assert client.post(f"/api/v1/ajo-groups/{group_id}/activate", headers=auth(owner)).status_code == 409
    assert client.patch(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner), json=settings()).status_code == 409
    assert create(client, owner, key).json()["status"] == "CANCELLED"
    with SessionLocal() as db:
        assert db.scalar(select(AjoInvitation).where(AjoInvitation.ajo_group_id == UUID(group_id))).status == "CANCELLED"
        outbox = db.scalar(select(Notification).where(Notification.ajo_group_id == UUID(group_id), Notification.channel == "WHATSAPP"))
        assert outbox.status == "CANCELLED"
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "CANCEL_AJO")) == 1


def test_active_groups_cannot_be_edited_or_cancelled(client):
    owner, _ = account(client, 1)
    group_id = create(client, owner).json()["id"]
    assert client.post(f"/api/v1/ajo-groups/{group_id}/activate", headers=auth(owner)).status_code == 200
    assert client.patch(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner), json=settings(name="Changed")).status_code == 409
    assert client.post(f"/api/v1/ajo-groups/{group_id}/cancel", headers=auth(owner)).status_code == 409


def test_cancellation_and_activation_are_serialized(client):
    owner, _ = account(client, 1)
    group_id = create(client, owner).json()["id"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        activation = executor.submit(client.post, f"/api/v1/ajo-groups/{group_id}/activate", headers=auth(owner))
        cancellation = executor.submit(client.post, f"/api/v1/ajo-groups/{group_id}/cancel", headers=auth(owner))
        responses = [activation.result(), cancellation.result()]
    assert sorted(response.status_code for response in responses) == [200, 409]
    group = client.get(f"/api/v1/ajo-groups/{group_id}", headers=auth(owner)).json()
    assert group["status"] in {"ACTIVE", "CANCELLED"}
    assert group["status"] == ("ACTIVE" if responses[0].status_code == 200 else "CANCELLED")
