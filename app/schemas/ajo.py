from datetime import date, datetime
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field, field_validator
SUPPORTED_CURRENCIES = {"NGN", "USD", "CAD", "GBP", "EUR"}


class AjoCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    currency: str = Field(default="NGN", min_length=3, max_length=3)
    contribution_amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    frequency: str = "MONTHLY"
    payout_type: str = "ROTATIONAL"
    start_date: date
    grace_period_days: int = Field(default=0, ge=0, le=365)
    late_fee: Decimal = Field(default=Decimal("0"), ge=0, le=0)

    @field_validator("name", "description", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("frequency", "payout_type", "currency")
    @classmethod
    def validate_options(cls, value: str, info):
        value = value.upper()
        if info.field_name == "frequency" and value not in {"DAILY", "WEEKLY", "MONTHLY"}:
            raise ValueError("Frequency must be DAILY, WEEKLY, or MONTHLY")
        if info.field_name == "payout_type" and value != "ROTATIONAL":
            raise ValueError("Only ROTATIONAL payouts are supported")
        if info.field_name == "currency" and value not in SUPPORTED_CURRENCIES:
            raise ValueError("Supported currencies are NGN, USD, CAD, GBP, and EUR")
        return value
class AjoResponse(BaseModel):
    id: UUID; name: str; currency: str; contribution_amount: Decimal; frequency: str; payout_type: str; start_date: date; status: str; created_by: UUID
    description: str | None
    grace_period_days: int
    late_fee: Decimal
    model_config = {"from_attributes": True}
class MyAjoResponse(AjoResponse):
    membership_role: str
    payout_position: int | None
class MemberAdd(BaseModel):
    user_id: UUID
    role: str = "MEMBER"
    payout_position: int | None = Field(default=None, ge=1)
class MemberRoleUpdate(BaseModel):
    role: str
class MemberResponse(BaseModel):
    id: UUID; user_id: UUID; role: str; payout_position: int | None; status: str
    model_config = {"from_attributes": True}
class InvitationAcceptedResponse(MemberResponse):
    ajo_group_id: UUID

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
class InvitationPage(BaseModel):
    items: list[InvitationResponse]
    page: int
    page_size: int
    total: int

class ActivationMember(BaseModel):
    member_id: UUID
    first_name: str
    last_name: str
    role: str
    payout_position: int

class ActivationPreview(BaseModel):
    group: AjoResponse
    members: list[ActivationMember]
    pending_invitations: int
    preview_hash: str

class ActivationRequest(BaseModel):
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")

class InvitationAccept(BaseModel):
    token: UUID
class DashboardContribution(BaseModel):
    schedule_id: UUID
    due_date: date
    expected_amount: Decimal
    status: str

class DashboardCycle(BaseModel):
    cycle_id: UUID
    cycle_number: int
    period_start: date
    period_end: date
    status: str
    expected_amount: Decimal

class DashboardActivity(BaseModel):
    action: str
    entity_type: str
    entity_id: UUID | None
    created_at: datetime

class GroupDashboard(BaseModel):
    group: AjoResponse
    membership: MemberResponse
    next_contribution: DashboardContribution | None
    current_cycle: DashboardCycle | None
    recent_activity: list[DashboardActivity]

class PendingContribution(BaseModel):
    contribution_id: UUID
    member_id: UUID
    first_name: str
    last_name: str
    cycle_number: int
    due_date: date
    paid_amount: Decimal
    payment_method: str | None
    payment_reference: str | None

class PendingContributions(BaseModel):
    items: list[PendingContribution]
    page: int
    page_size: int
    total: int
class ContributionHistoryItem(BaseModel):
    schedule_id: UUID
    cycle_id: UUID
    cycle_number: int
    member_id: UUID
    first_name: str
    last_name: str
    due_date: date
    expected_amount: Decimal
    schedule_status: str
    contribution_id: UUID | None
    paid_amount: Decimal | None
    contribution_status: str | None
    payment_method: str | None
    payment_reference: str | None
    submitted_at: datetime | None
    verified_at: datetime | None

class ContributionHistoryPage(BaseModel):
    items: list[ContributionHistoryItem]
    page: int
    page_size: int
    total: int

class CycleHistoryItem(BaseModel):
    cycle_id: UUID
    cycle_number: int
    period_start: date
    period_end: date
    recipient_member_id: UUID | None
    recipient_first_name: str | None
    recipient_last_name: str | None
    expected_amount: Decimal
    status: str
    payout_id: UUID | None
    payout_status: str | None
    actual_amount: Decimal | None
    paid_at: datetime | None

class CycleHistoryPage(BaseModel):
    items: list[CycleHistoryItem]
    page: int
    page_size: int
    total: int
