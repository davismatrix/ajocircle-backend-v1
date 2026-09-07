import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class ContributionSchedule(Base):
    __tablename__ = "contribution_schedules"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_cycle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_cycles.id"), index=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_members.id"), index=True)
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="EXPECTED")

class Contribution(Base):
    __tablename__ = "contributions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contribution_schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contribution_schedules.id"), unique=True)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_members.id"))
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    payment_method: Mapped[str | None] = mapped_column(String(30))
    payment_reference: Mapped[str | None] = mapped_column(String(255))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
