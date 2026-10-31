from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field
class ContributionSubmit(BaseModel):
    model_config = {"str_strip_whitespace": True}
    amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    payment_method: str = Field(min_length=2, max_length=30)
    payment_reference: str = Field(min_length=1, max_length=255)
class ContributionResponse(BaseModel):
    id: UUID; contribution_schedule_id: UUID; member_id: UUID; expected_amount: Decimal; paid_amount: Decimal; status: str; payment_method: str | None; payment_reference: str | None
    model_config = {"from_attributes": True}


class ContributionStatus(BaseModel):
    schedule_id: UUID
    schedule_status: str
    contribution_id: UUID | None
    contribution_status: str | None
    payment_method: str | None
    payment_reference: str | None
