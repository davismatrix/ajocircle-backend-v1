from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Notification, User
from app.schemas.notification import NotificationResponse


router = APIRouter()


@router.get("", response_model=list[NotificationResponse])
def list_notifications(limit: int = Query(50, ge=1, le=100), unread_only: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    return db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)).all()


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"count": db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_read(notification_id, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    if not notification.read_at:
        notification.read_at = datetime.now(timezone.utc)
        db.commit(); db.refresh(notification)
    return notification
