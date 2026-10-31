import uuid
from datetime import datetime
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    # The existing unique database column is reserved for verified E.164 numbers.
    verified_phone_number: Mapped[str | None] = mapped_column("phone_number", String(30), unique=True)
    claimed_phone_number: Mapped[str | None] = mapped_column(String(30))
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def phone_number(self) -> str | None:
        return self.verified_phone_number or self.claimed_phone_number

    @property
    def phone_verified(self) -> bool:
        return bool(self.verified_phone_number and self.phone_verified_at)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    role: Mapped[str] = mapped_column(String(30), default="USER")
