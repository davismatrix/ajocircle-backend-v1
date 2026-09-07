from datetime import datetime, timezone
from app.models import Notification


def notify(db, *, event_type: str, title: str, body: str, user_id=None, phone_number=None, ajo_group_id=None, channel="IN_APP", payload=None):
    notification = Notification(
        user_id=user_id,
        phone_number=phone_number,
        ajo_group_id=ajo_group_id,
        event_type=event_type,
        title=title,
        body=body,
        channel=channel,
        payload=payload,
        status="DELIVERED" if channel == "IN_APP" else "QUEUED",
        delivered_at=datetime.now(timezone.utc) if channel == "IN_APP" else None,
    )
    db.add(notification)
    return notification
