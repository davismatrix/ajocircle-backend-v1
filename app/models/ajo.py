import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class AjoGroup(Base):
    __tablename__ = "ajo_groups"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(String(3), default="NGN")
    contribution_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    frequency: Mapped[str] = mapped_column(String(20))
    payout_type: Mapped[str] = mapped_column(String(30))
    start_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

class AjoMember(Base):
    __tablename__ = "ajo_members"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_groups.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="MEMBER")
    payout_position: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AjoRule(Base):
    __tablename__ = "ajo_rules"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_groups.id"), unique=True)
    grace_period_days: Mapped[int] = mapped_column(Integer, default=0)
    late_fee: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)

class AjoCycle(Base):
    __tablename__ = "ajo_cycles"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_groups.id"), index=True)
    cycle_number: Mapped[int] = mapped_column(Integer)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    payout_recipient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ajo_members.id"))
    expected_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(String(30), default="UPCOMING")

class AjoInvitation(Base):
    __tablename__ = "ajo_invitations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_groups.id"), index=True)
    phone_number: Mapped[str] = mapped_column(String(30), index=True)
    role: Mapped[str] = mapped_column(String(30), default="MEMBER")
    payout_position: Mapped[int | None] = mapped_column(Integer)
    token: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    invited_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
