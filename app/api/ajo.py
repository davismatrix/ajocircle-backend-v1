from hashlib import sha256
import json
from typing import Literal

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from uuid import UUID
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.config import settings
from app.core.phone import normalize_phone
from app.models import AjoCreationRequest, Notification, AjoCycle, AjoGroup, AjoInvitation, AjoMember, AjoRule, AuditLog, Contribution, ContributionSchedule, Payout, User
from app.schemas.ajo import ActivationPreview, ActivationRequest, InvitationPage, InvitationAcceptedResponse, AjoCreate, AjoResponse, GroupDashboard, ContributionHistoryPage, CycleHistoryPage, InvitationAccept, InvitationCreate, InvitationResponse, PendingContributions, MemberAdd, MemberDetailResponse, MemberResponse, MemberRoleUpdate, MyAjoResponse
from app.services.audit import audit
from app.services.cycles import generate_cycles
from app.services.notifications import notify
router = APIRouter()

def require_membership(db, ajo_id, user, *, lock=False):
    query = select(AjoGroup).where(AjoGroup.id == ajo_id)
    ajo = db.scalar(query.with_for_update() if lock else query)
    if not ajo: raise HTTPException(404, "Ajo not found")
    member = db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.user_id == user.id, AjoMember.status == "ACTIVE"))
    if not member: raise HTTPException(403, "Not a member")
    return ajo, member

def require_group_role(db, ajo_id, user, roles=frozenset({"OWNER", "ADMIN"})):
    ajo, member = require_membership(db, ajo_id, user, lock=True)
    if member.role not in roles:
        raise HTTPException(403, "Insufficient permission")
    return ajo, member

def normalized_phone_number(value: str) -> str:
    return "".join(character for character in value if character.isdigit() or character == "+")

def validate_start_date(value):
    if value < datetime.now(timezone.utc).date():
        raise HTTPException(422, [{"loc": ["body", "start_date"], "msg": "Start date must be today or later (UTC)", "type": "value_error"}])


def request_hash(payload):
    data = payload.model_dump(mode="json")
    for field in ("contribution_amount", "late_fee"):
        data[field] = format(getattr(payload, field).normalize(), "f")
    return sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


@router.post("", response_model=AjoResponse, status_code=201)
def create_ajo(payload: AjoCreate, response: Response, idempotency_key: UUID | None = Header(default=None), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Serialize creations for this user, including keys which do not yet exist.
    if idempotency_key:
        db.scalar(select(User.id).where(User.id == user.id).with_for_update())
        previous = db.get(AjoCreationRequest, (user.id, idempotency_key))
        if previous:
            if previous.request_hash != request_hash(payload):
                raise HTTPException(409, "This request key was already used with different group settings")
            response.status_code = 200
            return db.get(AjoGroup, previous.ajo_group_id)
    # A retry remains valid even if the original start date has since passed.
    validate_start_date(payload.start_date)
    ajo = AjoGroup(**payload.model_dump(exclude={"grace_period_days", "late_fee"}), created_by=user.id)
    db.add(ajo); db.flush()
    db.add(AjoMember(ajo_group_id=ajo.id, user_id=user.id, role="OWNER", payout_position=1))
    db.add(AjoRule(ajo_group_id=ajo.id, grace_period_days=payload.grace_period_days, late_fee=payload.late_fee))
    if idempotency_key:
        db.add(AjoCreationRequest(user_id=user.id, request_key=idempotency_key, request_hash=request_hash(payload), ajo_group_id=ajo.id))
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="CREATE_AJO", entity_type="AjoGroup", entity_id=ajo.id)
    db.commit(); db.refresh(ajo)
    return ajo


@router.patch("/{ajo_id}", response_model=AjoResponse)
def edit_draft(ajo_id: UUID, payload: AjoCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user, {"OWNER"})
    if ajo.status != "DRAFT":
        raise HTTPException(409, "Only draft groups can be edited")
    validate_start_date(payload.start_date)
    current = AjoResponse.model_validate(ajo).model_dump(mode="json")
    before = {field: current[field] for field in AjoCreate.model_fields}
    after = payload.model_dump(mode="json")
    if all(getattr(ajo, field) == value for field, value in payload.model_dump().items()):
        return ajo
    for field, value in payload.model_dump(exclude={"grace_period_days", "late_fee"}).items():
        setattr(ajo, field, value)
    if not ajo.rule:
        ajo.rule = AjoRule(ajo_group_id=ajo.id)
    ajo.rule.grace_period_days = payload.grace_period_days
    ajo.rule.late_fee = payload.late_fee
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="UPDATE_AJO", entity_type="AjoGroup", entity_id=ajo.id, old_values=before, new_values=after)
    for member in db.scalars(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.status == "ACTIVE")):
        notify(db, event_type="AJO_UPDATED", title="Group settings updated", body=f"The owner updated {ajo.name}. Review the group settings before activation.", user_id=member.user_id, ajo_group_id=ajo.id)
    db.commit(); db.refresh(ajo)
    return ajo


@router.post("/{ajo_id}/cancel", response_model=AjoResponse)
def cancel_draft(ajo_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user, {"OWNER"})
    if ajo.status == "CANCELLED":
        return ajo
    if ajo.status != "DRAFT":
        raise HTTPException(409, "Only draft groups can be cancelled")
    ajo.status = "CANCELLED"
    for invitation in db.scalars(select(AjoInvitation).where(AjoInvitation.ajo_group_id == ajo.id, AjoInvitation.status == "PENDING")):
        invitation.status = "CANCELLED"
    for notification in db.scalars(select(Notification).where(Notification.ajo_group_id == ajo.id, Notification.event_type == "AJO_INVITATION", Notification.status == "QUEUED")):
        notification.status = "CANCELLED"
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="CANCEL_AJO", entity_type="AjoGroup", entity_id=ajo.id, old_values={"status": "DRAFT"}, new_values={"status": "CANCELLED"})
    for member in db.scalars(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.status == "ACTIVE")):
        notify(db, event_type="AJO_CANCELLED", title="Group cancelled", body=f"The owner cancelled {ajo.name}.", user_id=member.user_id, ajo_group_id=ajo.id)
    db.commit(); db.refresh(ajo)
    return ajo


@router.get("", response_model=list[MyAjoResponse])
def list_my_ajos(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(select(AjoGroup, AjoMember).join(AjoMember, AjoMember.ajo_group_id == AjoGroup.id).where(AjoMember.user_id == user.id, AjoMember.status == "ACTIVE").order_by(AjoGroup.created_by.desc(), AjoGroup.name)).all()
    return [{
        "id": ajo.id,
        "name": ajo.name,
        "currency": ajo.currency,
        "contribution_amount": ajo.contribution_amount,
        "frequency": ajo.frequency,
        "payout_type": ajo.payout_type,
        "start_date": ajo.start_date,
        "status": ajo.status,
        "created_by": ajo.created_by,
        "description": ajo.description,
        "grace_period_days": ajo.grace_period_days,
        "late_fee": ajo.late_fee,
        "membership_role": membership.role,
        "payout_position": membership.payout_position,
    } for ajo, membership in rows]

@router.get("/{ajo_id}", response_model=AjoResponse)
def get_ajo(ajo_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return require_membership(db, ajo_id, user)[0]

@router.get("/{ajo_id}/members", response_model=list[MemberDetailResponse])
def list_members(ajo_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_membership(db, ajo_id, user)
    rows = db.execute(select(AjoMember, User).join(User, AjoMember.user_id == User.id).where(AjoMember.ajo_group_id == ajo.id, AjoMember.status == "ACTIVE").order_by(AjoMember.payout_position, AjoMember.joined_at, AjoMember.id)).all()
    return [{
        "id": member.id,
        "user_id": member.user_id,
        "role": member.role,
        "payout_position": member.payout_position,
        "status": member.status,
        "first_name": member_user.first_name,
        "last_name": member_user.last_name,
        "email": member_user.email,
        "phone_number": member_user.phone_number,
    } for member, member_user in rows]

@router.post("/{ajo_id}/members", response_model=MemberResponse, status_code=201)
def add_member(ajo_id: UUID, payload: MemberAdd, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, actor = require_group_role(db, ajo_id, user)
    if ajo.status != "DRAFT":
        raise HTTPException(409, "Membership can only change while the group is DRAFT")
    if not db.get(User, payload.user_id): raise HTTPException(404, "User not found")
    if db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.user_id == payload.user_id)):
        raise HTTPException(409, "Already a member")
    role = payload.role.upper()
    if role not in {"MEMBER", "ADMIN", "TREASURER"}:
        raise HTTPException(422, "Member role must be MEMBER, ADMIN, or TREASURER")
    member = AjoMember(ajo_group_id=ajo.id, user_id=payload.user_id, role=role, payout_position=payload.payout_position)
    db.add(member); db.flush()
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="ADD_MEMBER", entity_type="AjoMember", entity_id=member.id, new_values={"user_id": str(payload.user_id)})
    db.commit(); db.refresh(member)
    return member

@router.patch("/{ajo_id}/members/{member_id}/role", response_model=MemberResponse)
def update_member_role(ajo_id: UUID, member_id: UUID, payload: MemberRoleUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user, {"OWNER"})
    if ajo.status == "CANCELLED":
        raise HTTPException(409, "Roles cannot be changed in a cancelled group")
    member = db.get(AjoMember, member_id)
    if not member or member.ajo_group_id != ajo.id:
        raise HTTPException(404, "Member not found")
    if member.status != "ACTIVE":
        raise HTTPException(409, "Only active members can change roles")
    role = payload.role.upper()
    if role not in {"ADMIN", "TREASURER", "MEMBER"}:
        raise HTTPException(422, "Role must be ADMIN, TREASURER, or MEMBER")
    if member.role == "OWNER":
        raise HTTPException(409, "Owner role cannot be changed")
    old_role = member.role
    if old_role == role:
        return member
    member.role = role
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="UPDATE_MEMBER_ROLE", entity_type="AjoMember", entity_id=member.id, old_values={"role": old_role}, new_values={"role": role})
    db.commit(); db.refresh(member)
    return member

def activation_roster(db, ajo):
    return db.execute(select(AjoMember, User).join(User, AjoMember.user_id == User.id)
        .where(AjoMember.ajo_group_id == ajo.id, AjoMember.status == "ACTIVE")
        .order_by(AjoMember.payout_position, AjoMember.joined_at, AjoMember.id)).all()


def activation_hash(ajo, roster):
    group = AjoResponse.model_validate(ajo).model_dump(mode="json")
    members = [{"id": str(member.id), "role": member.role, "position": member.payout_position,
                "first_name": user.first_name, "last_name": user.last_name} for member, user in roster]
    return sha256(json.dumps({"group": group, "members": members}, sort_keys=True).encode()).hexdigest()


@router.get("/{ajo_id}/activation-preview", response_model=ActivationPreview)
def activation_preview(ajo_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user)
    if ajo.status != "DRAFT": raise HTTPException(409, "Only draft groups can be activated")
    roster = activation_roster(db, ajo)
    pending = db.scalar(select(func.count()).select_from(AjoInvitation).where(
        AjoInvitation.ajo_group_id == ajo.id, AjoInvitation.status == "PENDING",
        AjoInvitation.expires_at > datetime.now(timezone.utc))) or 0
    return {"group": ajo, "members": [{"member_id": member.id, "first_name": member_user.first_name,
        "last_name": member_user.last_name, "role": member.role, "payout_position": position}
        for position, (member, member_user) in enumerate(roster, 1)],
        "pending_invitations": pending, "preview_hash": activation_hash(ajo, roster)}


@router.post("/{ajo_id}/activate")
def activate(ajo_id: UUID, payload: ActivationRequest | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, actor = require_group_role(db, ajo_id, user)
    if ajo.status != "DRAFT": raise HTTPException(409, "Ajo is not in DRAFT state")
    now = datetime.now(timezone.utc)
    pending = db.scalar(select(func.count()).select_from(AjoInvitation).where(
        AjoInvitation.ajo_group_id == ajo.id, AjoInvitation.status == "PENDING", AjoInvitation.expires_at > now)) or 0
    if pending: raise HTTPException(409, "Pending invitations must be accepted or cancelled before activation")
    roster = activation_roster(db, ajo)
    if payload and payload.preview_hash != activation_hash(ajo, roster):
        raise HTTPException(409, "Group settings or membership changed. Review the activation details again")
    validate_start_date(ajo.start_date)
    try:
        generate_cycles(db, ajo)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    ajo.status = "ACTIVE"
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="ACTIVATE_AJO", entity_type="AjoGroup", entity_id=ajo.id)
    db.commit()
    return {"status": "ACTIVE", "ajo_id": str(ajo.id)}


@router.get("/{ajo_id}/invitations", response_model=InvitationPage)
def list_invitations(ajo_id: UUID, response: Response, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user)
    response.headers["Cache-Control"] = "no-store"
    query = select(AjoInvitation).where(AjoInvitation.ajo_group_id == ajo.id,
        AjoInvitation.status == "PENDING", AjoInvitation.expires_at > datetime.now(timezone.utc))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(AjoInvitation.created_at.desc(), AjoInvitation.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": items, "page": page, "page_size": page_size, "total": total}


@router.post("/{ajo_id}/invitations/{invitation_id}/cancel", response_model=InvitationResponse)
def cancel_invitation(ajo_id: UUID, invitation_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user)
    invitation = db.get(AjoInvitation, invitation_id)
    if not invitation or invitation.ajo_group_id != ajo.id: raise HTTPException(404, "Invitation not found")
    if invitation.status == "CANCELLED": return invitation
    if ajo.status != "DRAFT" or invitation.status != "PENDING": raise HTTPException(409, "Only pending draft invitations can be cancelled")
    invitation.status = "CANCELLED"
    for notification in db.scalars(select(Notification).where(Notification.ajo_group_id == ajo.id,
        Notification.event_type == "AJO_INVITATION", Notification.status == "QUEUED",
        Notification.payload["invitation_token"].astext == str(invitation.token))):
        notification.status = "CANCELLED"
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="CANCEL_INVITATION", entity_type="AjoInvitation", entity_id=invitation.id)
    db.commit(); db.refresh(invitation)
    return invitation


@router.post("/{ajo_id}/invitations", response_model=InvitationResponse, status_code=201)
def create_invitation(ajo_id: UUID, payload: InvitationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_group_role(db, ajo_id, user)
    if ajo.status != "DRAFT":
        raise HTTPException(409, "Membership can only change while the group is DRAFT")
    try:
        phone_number = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    role = payload.role.upper()
    if role not in {"MEMBER", "ADMIN", "TREASURER"}:
        raise HTTPException(422, "Invitation role must be MEMBER, ADMIN, or TREASURER")
    existing_member = db.scalar(select(AjoMember.id).join(User, AjoMember.user_id == User.id).where(
        AjoMember.ajo_group_id == ajo.id, User.verified_phone_number == phone_number,
        User.phone_verified_at.is_not(None)))
    if existing_member:
        raise HTTPException(409, "This phone number already belongs to a group member")
    existing = db.scalar(select(AjoInvitation).where(AjoInvitation.ajo_group_id == ajo.id, AjoInvitation.phone_number == phone_number, AjoInvitation.status == "PENDING"))
    if existing and existing.expires_at > datetime.now(timezone.utc):
        raise HTTPException(409, "A pending invitation already exists for this phone number")
    if existing:
        existing.status = "EXPIRED"
    invitation = AjoInvitation(ajo_group_id=ajo.id, phone_number=phone_number, role=role, payout_position=payload.payout_position, invited_by=user.id, expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.invitation_expire_hours))
    db.add(invitation); db.flush()
    notify(db, event_type="AJO_INVITATION", title=f"Invitation to join {ajo.name}", body=f"You have been invited to join {ajo.name}.", phone_number=phone_number, ajo_group_id=ajo.id, channel="WHATSAPP", payload={"invitation_token": str(invitation.token)})
    audit(db, user_id=user.id, ajo_group_id=ajo.id, action="CREATE_INVITATION", entity_type="AjoInvitation", entity_id=invitation.id, new_values={"phone_number": phone_number, "role": role})
    db.commit(); db.refresh(invitation)
    return invitation

@router.post("/invitations/accept", response_model=InvitationAcceptedResponse)
def accept_invitation(payload: InvitationAccept, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invitation = db.scalar(select(AjoInvitation).where(AjoInvitation.token == payload.token))
    if not invitation:
        raise HTTPException(404, "Invitation not found")
    ajo = db.scalar(select(AjoGroup).where(AjoGroup.id == invitation.ajo_group_id).with_for_update())
    # Verification and acceptance must agree on the account's current number.
    user = db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
    db.refresh(invitation, with_for_update=True)
    # A lost response can be retried by the same account, even after activation.
    if invitation.status == "ACCEPTED" and invitation.accepted_by == user.id and ajo.status in {"DRAFT", "ACTIVE"}:
        member = db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == ajo.id, AjoMember.user_id == user.id, AjoMember.status == "ACTIVE"))
        if member:
            return member
    if ajo.status != "DRAFT":
        raise HTTPException(409, "Membership can only change while the group is DRAFT")
    if invitation.status != "PENDING":
        raise HTTPException(409, "Invitation is no longer pending")
    if invitation.expires_at <= datetime.now(timezone.utc):
        invitation.status = "EXPIRED"; db.commit()
        raise HTTPException(409, "Invitation has expired")
    if not user.phone_verified:
        raise HTTPException(403, "Verify your phone number before accepting this invitation")
    if user.verified_phone_number != invitation.phone_number:
        raise HTTPException(403, "Your verified phone number does not match this invitation")
    if db.scalar(select(AjoMember).where(AjoMember.ajo_group_id == invitation.ajo_group_id, AjoMember.user_id == user.id)):
        raise HTTPException(409, "You are already a member")
    member = AjoMember(ajo_group_id=invitation.ajo_group_id, user_id=user.id, role=invitation.role, payout_position=invitation.payout_position)
    invitation.status = "ACCEPTED"; invitation.accepted_by = user.id; invitation.accepted_at = datetime.now(timezone.utc)
    db.add(member); db.flush()
    audit(db, user_id=user.id, ajo_group_id=invitation.ajo_group_id, action="ACCEPT_INVITATION", entity_type="AjoInvitation", entity_id=invitation.id)
    notify(db, event_type="INVITATION_ACCEPTED", title="Ajo invitation accepted", body="You are now a group member.", user_id=user.id, ajo_group_id=invitation.ajo_group_id)
    db.commit(); db.refresh(member)
    return member

@router.get("/{ajo_id}/dashboard", response_model=GroupDashboard)
def group_dashboard(ajo_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, member = require_membership(db, ajo_id, user)
    next_schedule = db.scalar(select(ContributionSchedule).join(AjoCycle).where(ContributionSchedule.member_id == member.id, ContributionSchedule.status.in_(("EXPECTED", "SUBMITTED"))).order_by(ContributionSchedule.due_date))
    current_cycle = db.scalar(select(AjoCycle).where(AjoCycle.ajo_group_id == ajo.id, AjoCycle.period_start <= datetime.now(timezone.utc).date(), AjoCycle.period_end >= datetime.now(timezone.utc).date()).order_by(AjoCycle.cycle_number))
    activity = db.scalars(select(AuditLog).where(AuditLog.ajo_group_id == ajo.id).order_by(AuditLog.created_at.desc()).limit(10)).all()
    return {
        "group": ajo,
        "membership": member,
        "next_contribution": None if not next_schedule else {"schedule_id": str(next_schedule.id), "due_date": next_schedule.due_date, "expected_amount": next_schedule.expected_amount, "status": next_schedule.status},
        "current_cycle": None if not current_cycle else {"cycle_id": str(current_cycle.id), "cycle_number": current_cycle.cycle_number, "period_start": current_cycle.period_start, "period_end": current_cycle.period_end, "status": current_cycle.status, "expected_amount": current_cycle.expected_amount},
        "recent_activity": [{"action": item.action, "entity_type": item.entity_type, "entity_id": str(item.entity_id) if item.entity_id else None, "created_at": item.created_at} for item in activity],
    }

@router.get("/{ajo_id}/contributions/pending", response_model=PendingContributions)
def pending_contributions(ajo_id: UUID, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, actor = require_membership(db, ajo_id, user)
    if actor.role not in {"OWNER", "ADMIN", "TREASURER"}:
        raise HTTPException(403, "Insufficient permission")
    query = (select(Contribution, ContributionSchedule, AjoCycle, AjoMember, User)
        .join(ContributionSchedule, Contribution.contribution_schedule_id == ContributionSchedule.id)
        .join(AjoCycle, ContributionSchedule.ajo_cycle_id == AjoCycle.id)
        .join(AjoMember, Contribution.member_id == AjoMember.id)
        .join(User, AjoMember.user_id == User.id)
        .where(AjoCycle.ajo_group_id == ajo.id, Contribution.status == "SUBMITTED"))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(Contribution.submitted_at, Contribution.id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [{"contribution_id": contribution.id, "member_id": member.id,
        "first_name": member_user.first_name, "last_name": member_user.last_name,
        "cycle_number": cycle.cycle_number, "due_date": schedule.due_date,
        "paid_amount": contribution.paid_amount, "payment_method": contribution.payment_method,
        "payment_reference": contribution.payment_reference} for contribution, schedule, cycle, member, member_user in rows],
        "page": page, "page_size": page_size, "total": total}


@router.get("/{ajo_id}/contributions/history", response_model=ContributionHistoryPage)
def contribution_history(ajo_id: UUID, response: Response, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), member_id: UUID | None = None, status: Literal["EXPECTED", "PENDING", "SUBMITTED", "VERIFIED"] | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, actor = require_membership(db, ajo_id, user)
    response.headers["Cache-Control"] = "no-store"
    query = (select(ContributionSchedule, Contribution, AjoCycle, User)
        .join(AjoCycle, ContributionSchedule.ajo_cycle_id == AjoCycle.id)
        .outerjoin(Contribution, Contribution.contribution_schedule_id == ContributionSchedule.id)
        .join(AjoMember, ContributionSchedule.member_id == AjoMember.id)
        .join(User, AjoMember.user_id == User.id)
        .where(AjoCycle.ajo_group_id == ajo.id))
    if member_id:
        if actor.role not in {"OWNER", "ADMIN", "TREASURER"} and actor.id != member_id:
            raise HTTPException(403, "Insufficient permission")
        if not db.scalar(select(AjoMember.id).where(AjoMember.id == member_id, AjoMember.ajo_group_id == ajo.id)):
            raise HTTPException(404, "Member not found in this group")
        query = query.where(ContributionSchedule.member_id == member_id)
    elif actor.role not in {"OWNER", "ADMIN", "TREASURER"}:
        query = query.where(ContributionSchedule.member_id == actor.id)
    if status:
        query = query.where(func.coalesce(Contribution.status, ContributionSchedule.status) == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(ContributionSchedule.due_date.desc(), ContributionSchedule.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [{"schedule_id": schedule.id, "cycle_id": cycle.id, "cycle_number": cycle.cycle_number,
        "member_id": schedule.member_id, "first_name": member_user.first_name, "last_name": member_user.last_name,
        "due_date": schedule.due_date, "expected_amount": schedule.expected_amount, "schedule_status": schedule.status,
        "contribution_id": contribution.id if contribution else None, "paid_amount": contribution.paid_amount if contribution else None,
        "contribution_status": contribution.status if contribution else None,
        "payment_method": contribution.payment_method if contribution else None,
        "payment_reference": contribution.payment_reference if contribution else None,
        "submitted_at": contribution.submitted_at if contribution else None,
        "verified_at": contribution.verified_at if contribution else None} for schedule, contribution, cycle, member_user in rows],
        "page": page, "page_size": page_size, "total": total}


@router.get("/{ajo_id}/cycles/history", response_model=CycleHistoryPage)
def cycle_history(ajo_id: UUID, response: Response, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), payout_status: Literal["PENDING", "PAID"] | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ajo, _ = require_membership(db, ajo_id, user)
    response.headers["Cache-Control"] = "no-store"
    query = (select(AjoCycle, Payout, User.first_name, User.last_name)
        .outerjoin(Payout, Payout.ajo_cycle_id == AjoCycle.id)
        .outerjoin(AjoMember, AjoMember.id == AjoCycle.payout_recipient_id)
        .outerjoin(User, AjoMember.user_id == User.id).where(AjoCycle.ajo_group_id == ajo.id))
    if payout_status:
        query = query.where(Payout.status == payout_status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.execute(query.order_by(AjoCycle.cycle_number.desc(), AjoCycle.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [{"cycle_id": cycle.id, "cycle_number": cycle.cycle_number,
        "period_start": cycle.period_start, "period_end": cycle.period_end,
        "recipient_member_id": cycle.payout_recipient_id, "recipient_first_name": first_name, "recipient_last_name": last_name,
        "expected_amount": cycle.expected_amount, "status": cycle.status, "payout_id": payout.id if payout else None,
        "payout_status": payout.status if payout else None, "actual_amount": payout.actual_amount if payout else None,
        "paid_at": payout.paid_at if payout else None} for cycle, payout, first_name, last_name in rows],
        "page": page, "page_size": page_size, "total": total}
