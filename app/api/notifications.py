from datetime import datetime, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Notification, User
from app.schemas.notification import NotificationResponse, NotificationUnreadCount

router = APIRouter()


def inbox_query(user_id):
    return select(Notification).where(Notification.user_id == user_id,
        Notification.channel == "IN_APP", Notification.status == "DELIVERED")


@router.get("", response_model=list[NotificationResponse])
def list_notifications(response: Response, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), unread_only: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    query = inbox_query(user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    return db.scalars(query.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(offset).limit(limit)).all()


@router.get("/unread-count", response_model=NotificationUnreadCount)
def unread_count(response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    query = inbox_query(user.id).where(Notification.read_at.is_(None))
    return {"count": db.scalar(select(func.count()).select_from(query.subquery())) or 0}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_read(notification_id: UUID, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    notification = db.scalar(inbox_query(user.id).where(Notification.id == notification_id).with_for_update())
    if not notification:
        raise HTTPException(404, "Notification not found")
    if not notification.read_at:
        notification.read_at = datetime.now(timezone.utc)
        db.commit(); db.refresh(notification)
    return notification
