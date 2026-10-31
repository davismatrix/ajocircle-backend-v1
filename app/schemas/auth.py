from pydantic import BaseModel, EmailStr, Field, field_validator
from uuid import UUID
from datetime import datetime


class PasswordRequest(BaseModel):
    @field_validator("password", check_fields=False)
    @classmethod
    def password_must_fit_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must not exceed 72 bytes")
        return value


class RegisterRequest(PasswordRequest):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone_number: str | None = Field(default=None, max_length=30)
    password: str = Field(min_length=8)
class LoginRequest(PasswordRequest):
    email: EmailStr
    password: str
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
class CurrentUserResponse(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    email: EmailStr
    phone_number: str | None
    phone_verified: bool
    role: str
    model_config = {"from_attributes": True}


class PhoneVerificationStart(BaseModel):
    phone_number: str = Field(min_length=7, max_length=30)

class PhoneVerificationCheck(BaseModel):
    attempt_id: UUID
    code: str | None = Field(default=None, pattern=r"^[0-9]{4,10}$")
    firebase_id_token: str | None = Field(default=None, min_length=1, max_length=16384)

class PhoneVerificationStartResponse(BaseModel):
    attempt_id: UUID | None = None
    already_verified: bool = False
    phone_number: str | None = None
    expires_at: datetime | None = None
