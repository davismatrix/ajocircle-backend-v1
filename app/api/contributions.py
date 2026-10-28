from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import AjoMember, Contribution, ContributionSchedule, FinancialLedger, User, AjoCycle, AjoGroup
from app.schemas.contribution import ContributionResponse, ContributionSubmit
from app.services.audit import audit
from app.services.notifications import notify
router = APIRouter()

@router.post("/{schedule_id}/submit", response_model=ContributionResponse, status_code=201)
def submit(schedule_id: UUID, payload: ContributionSubmit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    schedule = db.scalar(select(ContributionSchedule).where(ContributionSchedule.id == schedule_id).with_for_update())
    if not schedule: raise HTTPException(404, "Contribution schedule not found")
    member = db.scalar(select(AjoMember).where(AjoMember.id == schedule.member_id, AjoMember.user_id == user.id, AjoMember.status == "ACTIVE"))
    if not member: raise HTTPException(403, "Access denied")
    if payload.amount != schedule.expected_amount: raise HTTPException(400, "Amount must equal the expected contribution")
    if db.scalar(select(Contribution).where(Contribution.contribution_schedule_id == schedule.id)): raise HTTPException(409, "Contribution already submitted")
    contribution = Contribution(contribution_schedule_id=schedule.id, member_id=member.id, expected_amount=schedule.expected_amount, paid_amount=payload.amount, status="SUBMITTED", payment_method=payload.payment_method, payment_reference=payload.payment_reference, submitted_at=datetime.now(timezone.utc))
    db.add(contribution); db.flush(); schedule.status = "SUBMITTED"
    cycle = db.get(AjoCycle, schedule.ajo_cycle_id)
    audit(db, user_id=user.id, ajo_group_id=cycle.ajo_group_id, action="SUBMIT_CONTRIBUTION", entity_type="Contribution", entity_id=contribution.id, new_values={"amount": str(payload.amount)})
    notify(db, event_type="CONTRIBUTION_SUBMITTED", title="Contribution submitted", body="Your contribution is awaiting verification.", user_id=user.id, ajo_group_id=cycle.ajo_group_id)
    db.commit(); db.refresh(contribution)
    return contribution

@router.post("/{contribution_id}/verify", response_model=ContributionResponse)
def verify(contribution_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contribution = db.scalar(select(Contribution).where(Contribution.id == contribution_id).with_for_update())
    if not contribution: raise HTTPException(404, "Contribution not found")
    schedule = db.get(ContributionSchedule, contribution.contribution_schedule_id)
    member = db.get(AjoMember, schedule.member_id)
    actor = db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == member.ajo_group_id, AjoMember.user_id == user.id, AjoMember.status == "ACTIVE"))
    if not actor or actor.role not in {"OWNER", "ADMIN", "TREASURER"}: raise HTTPException(403, "Insufficient permission")
    if contribution.status != "SUBMITTED": raise HTTPException(409, "Only submitted contributions can be verified")
    if contribution.paid_amount != schedule.expected_amount:
        raise HTTPException(409, "Partial contributions cannot be verified")
    contribution.status = "VERIFIED"; contribution.verified_at = datetime.now(timezone.utc); contribution.verified_by = user.id; schedule.status = "PAID"
    db.add(FinancialLedger(ajo_group_id=member.ajo_group_id, member_id=member.id, transaction_type="CONTRIBUTION", reference_type="CONTRIBUTION", reference_id=contribution.id, amount=contribution.paid_amount, currency=db.get(AjoGroup, member.ajo_group_id).currency))
    audit(db, user_id=user.id, ajo_group_id=member.ajo_group_id, action="VERIFY_CONTRIBUTION", entity_type="Contribution", entity_id=contribution.id, new_values={"amount": str(contribution.paid_amount)})
    notify(db, event_type="CONTRIBUTION_VERIFIED", title="Contribution verified", body="Your contribution has been verified.", user_id=member.user_id, ajo_group_id=member.ajo_group_id)
    db.commit(); db.refresh(contribution)
    return contribution
