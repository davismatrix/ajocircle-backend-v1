import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class Payout(Base):
    __tablename__ = "payouts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_cycle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_cycles.id"), unique=True)
    recipient_member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_members.id"))
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    actual_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    payment_method: Mapped[str | None] = mapped_column(String(30))
    payment_reference: Mapped[str | None] = mapped_column(String(255))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
