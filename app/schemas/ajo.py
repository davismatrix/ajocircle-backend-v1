from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field
class AjoCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    description: str | None = None
    currency: str = Field(default="NGN", min_length=3, max_length=3)
    contribution_amount: Decimal = Field(gt=0)
    frequency: str = "MONTHLY"
    payout_type: str = "ROTATIONAL"
    start_date: date
    grace_period_days: int = Field(default=0, ge=0)
    late_fee: Decimal = Field(default=Decimal("0"), ge=0)
class AjoResponse(BaseModel):
    id: UUID; name: str; currency: str; contribution_amount: Decimal; frequency: str; payout_type: str; start_date: date; status: str; created_by: UUID
    model_config = {"from_attributes": True}
class MyAjoResponse(AjoResponse):
    membership_role: str
    payout_position: int | None
class MemberAdd(BaseModel):
    user_id: UUID
    role: str = "MEMBER"
    payout_position: int | None = None
class MemberRoleUpdate(BaseModel):
    role: str
class MemberResponse(BaseModel):
    id: UUID; user_id: UUID; role: str; payout_position: int | None; status: str
    model_config = {"from_attributes": True}
class MemberDetailResponse(MemberResponse):
    first_name: str
    last_name: str
    email: str
    phone_number: str | None
class InvitationCreate(BaseModel):
    phone_number: str = Field(min_length=7, max_length=30)
    role: str = "MEMBER"
    payout_position: int | None = Field(default=None, ge=1)
class InvitationResponse(BaseModel):
    id: UUID; ajo_group_id: UUID; phone_number: str; role: str; payout_position: int | None; token: UUID; status: str; expires_at: datetime; created_at: datetime
    model_config = {"from_attributes": True}
class InvitationAccept(BaseModel):
    token: UUID
class GroupDashboard(BaseModel):
    group: AjoResponse
    membership: MemberResponse
    next_contribution: dict | None
    current_cycle: dict | None
    recent_activity: list[dict]
class GroupHistory(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int
