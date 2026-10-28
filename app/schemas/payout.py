from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, Field
class PayoutMarkPaid(BaseModel):
    actual_amount: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    payment_method: str = Field(min_length=2, max_length=30)
    payment_reference: str = Field(min_length=1, max_length=255)
class PayoutResponse(BaseModel):
    id: UUID; ajo_cycle_id: UUID; recipient_member_id: UUID; expected_amount: Decimal; actual_amount: Decimal | None; status: str; payment_reference: str | None
    model_config = {"from_attributes": True}
