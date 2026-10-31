from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class NotificationResponse(BaseModel):
    id: UUID; ajo_group_id: UUID | None; event_type: str; channel: str; title: str; body: str; status: str; read_at: datetime | None; created_at: datetime
    model_config = {"from_attributes": True}


class NotificationUnreadCount(BaseModel):
    count: int = Field(ge=0)
