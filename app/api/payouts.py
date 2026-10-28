from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import AjoCycle, AjoMember, FinancialLedger, Payout, User, AjoGroup, Contribution, ContributionSchedule
from app.schemas.payout import PayoutMarkPaid, PayoutResponse
from app.services.audit import audit
from app.services.notifications import notify
router = APIRouter()

@router.post("/{payout_id}/mark-paid", response_model=PayoutResponse)
def mark_paid(payout_id: UUID, payload: PayoutMarkPaid, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    payout = db.scalar(select(Payout).where(Payout.id == payout_id).with_for_update())
    if not payout: raise HTTPException(404, "Payout not found")
    cycle = db.get(AjoCycle, payout.ajo_cycle_id)
    actor = db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == cycle.ajo_group_id, AjoMember.user_id == user.id, AjoMember.status == "ACTIVE"))
    if not actor or actor.role not in {"OWNER", "ADMIN", "TREASURER"}: raise HTTPException(403, "Insufficient permission")
    if payout.status == "PAID": raise HTTPException(409, "Payout already marked paid")
    if payload.actual_amount != payout.expected_amount: raise HTTPException(400, "Amount must equal the expected payout")
    verified_amount = db.scalar(
        select(func.coalesce(func.sum(Contribution.paid_amount), 0))
        .join(ContributionSchedule, Contribution.contribution_schedule_id == ContributionSchedule.id)
        .where(ContributionSchedule.ajo_cycle_id == cycle.id, Contribution.status == "VERIFIED")
    )
    if verified_amount < payout.expected_amount:
        raise HTTPException(409, "Payout requires fully verified cycle contributions")
    payout.actual_amount = payload.actual_amount; payout.payment_method = payload.payment_method; payout.payment_reference = payload.payment_reference; payout.status = "PAID"; payout.paid_at = datetime.now(timezone.utc); cycle.status = "PAID"
    db.add(FinancialLedger(ajo_group_id=cycle.ajo_group_id, member_id=payout.recipient_member_id, transaction_type="PAYOUT", reference_type="PAYOUT", reference_id=payout.id, amount=-payload.actual_amount, currency=db.get(AjoGroup, cycle.ajo_group_id).currency))
    audit(db, user_id=user.id, ajo_group_id=cycle.ajo_group_id, action="MARK_PAYOUT_PAID", entity_type="Payout", entity_id=payout.id, new_values={"amount": str(payload.actual_amount)})
    notify(db, event_type="PAYOUT_RECORDED", title="Payout recorded", body="Your payout has been marked as paid.", user_id=db.get(AjoMember, payout.recipient_member_id).user_id, ajo_group_id=cycle.ajo_group_id)
    db.commit(); db.refresh(payout)
    return payout
