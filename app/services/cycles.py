from calendar import monthrange
from datetime import date, timedelta
from sqlalchemy import select
from app.models.ajo import AjoMember, AjoCycle
from app.models.contribution import ContributionSchedule
from app.models.payout import Payout

def add_months(value: date, months: int) -> date:
    index = value.month - 1 + months
    year = value.year + index // 12
    month = index % 12 + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))

def generate_cycles(db, ajo):
    members = db.scalars(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.status == "ACTIVE").order_by(AjoMember.payout_position, AjoMember.joined_at)).all()
    if not members:
        raise ValueError("Ajo must have at least one active member")
    for position, member in enumerate(members, 1):
        member.payout_position = position
    for number, recipient in enumerate(members, 1):
        start = add_months(ajo.start_date, number - 1)
        end = add_months(ajo.start_date, number) - timedelta(days=1)
        cycle = AjoCycle(ajo_group_id=ajo.id, cycle_number=number, period_start=start, period_end=end, payout_recipient_id=recipient.id, expected_amount=ajo.contribution_amount * len(members))
        db.add(cycle)
        db.flush()
        db.add(Payout(ajo_cycle_id=cycle.id, recipient_member_id=recipient.id, expected_amount=cycle.expected_amount))
        for member in members:
            db.add(ContributionSchedule(ajo_cycle_id=cycle.id, member_id=member.id, expected_amount=ajo.contribution_amount, due_date=start))
