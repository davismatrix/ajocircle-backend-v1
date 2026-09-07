import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class FinancialLedger(Base):
    __tablename__ = "financial_ledger"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ajo_group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ajo_groups.id"), index=True)
    member_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ajo_members.id"))
    transaction_type: Mapped[str] = mapped_column(String(50))
    reference_type: Mapped[str] = mapped_column(String(50))
    reference_id: Mapped[uuid.UUID]
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3), default="NGN")
    transaction_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
