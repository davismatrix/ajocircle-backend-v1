from datetime import datetime, timedelta, timezone
from hashlib import sha256

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.phone import normalize_phone
from app.models.phone_verification import PhoneVerificationAttempt
from app.models.user import User
from app.schemas.auth import CurrentUserResponse, PhoneVerificationCheck, PhoneVerificationStart, PhoneVerificationStartResponse
from app.services.phone_verification import ProviderUnavailable, get_phone_provider

router = APIRouter()
SEND_COOLDOWN_SECONDS = 60
CHECK_LIMIT = 5
VERIFICATION_MINUTES = 10


def provider_or_503():
    try:
        return get_phone_provider()
    except ProviderUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


def locked_user(db, user_id):
    return db.scalar(select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True))


@router.get("/phone-verification", response_model=PhoneVerificationStartResponse)
def current_phone_verification(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    attempt = db.scalar(select(PhoneVerificationAttempt).where(
        PhoneVerificationAttempt.user_id == user.id, PhoneVerificationAttempt.provider == settings.phone_verification_provider.upper(), PhoneVerificationAttempt.status == "PENDING",
        PhoneVerificationAttempt.expires_at > datetime.now(timezone.utc),
    ).order_by(PhoneVerificationAttempt.created_at.desc()))
    if not attempt:
        return {"already_verified": user.phone_verified}
    return {"attempt_id": attempt.id, "phone_number": attempt.phone_number, "expires_at": attempt.expires_at, "already_verified": False}


@router.post("/phone-verification/start", response_model=PhoneVerificationStartResponse)
def start_phone_verification(payload: PhoneVerificationStart, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        phone = normalize_phone(payload.phone_number)
    except ValueError as exc:
        raise HTTPException(422, [{"loc": ["body", "phone_number"], "msg": str(exc), "type": "value_error"}]) from exc
    provider = provider_or_503()
    user = locked_user(db, user.id)
    if user.verified_phone_number == phone and user.phone_verified_at:
        return {"already_verified": True}
    # Serialize the per-number quota across accounts without exposing number ownership.
    key = int.from_bytes(sha256(phone.encode()).digest()[:8], 'big', signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
    now = datetime.now(timezone.utc)
    last_hour = now - timedelta(hours=1)
    by_user = db.scalar(select(func.count()).select_from(PhoneVerificationAttempt).where(
        PhoneVerificationAttempt.user_id == user.id, PhoneVerificationAttempt.created_at >= last_hour)) or 0
    by_phone = db.scalar(select(func.count()).select_from(PhoneVerificationAttempt).where(
        PhoneVerificationAttempt.phone_number == phone, PhoneVerificationAttempt.created_at >= last_hour)) or 0
    recent = db.scalar(select(PhoneVerificationAttempt.id).where(
        PhoneVerificationAttempt.user_id == user.id, PhoneVerificationAttempt.created_at > now - timedelta(seconds=SEND_COOLDOWN_SECONDS)).limit(1))
    if recent or by_user >= settings.phone_verification_requests_per_hour or by_phone >= settings.phone_verification_requests_per_hour:
        raise HTTPException(429, "Too many verification requests. Please wait before trying again.")
    db.execute(update(PhoneVerificationAttempt).where(PhoneVerificationAttempt.user_id == user.id,
        PhoneVerificationAttempt.status.in_(["STARTING", "PENDING"])).values(status="CANCELLED"))
    attempt = PhoneVerificationAttempt(user_id=user.id, phone_number=phone, provider=settings.phone_verification_provider.upper(),
        status="STARTING", check_attempts=0, expires_at=now + timedelta(minutes=VERIFICATION_MINUTES))
    db.add(attempt); db.commit(); db.refresh(attempt)
    try:
        reference = provider.start(phone)
    except ProviderUnavailable as exc:
        attempt.status = "FAILED"; db.commit()
        raise HTTPException(503, "Unable to send a verification code. Please try again later.") from exc
    # Reacquire the account lock and never resurrect a superseded request.
    locked_user(db, user.id)
    attempt = db.scalar(select(PhoneVerificationAttempt).where(PhoneVerificationAttempt.id == attempt.id).with_for_update().execution_options(populate_existing=True))
    if attempt.status != "STARTING":
        raise HTTPException(409, "Verification request was replaced. Start again.")
    attempt.provider_reference = reference; attempt.status = "PENDING"
    db.commit(); db.refresh(attempt)
    return {"attempt_id": attempt.id, "phone_number": phone, "expires_at": attempt.expires_at}


@router.post("/phone-verification/check", response_model=CurrentUserResponse)
def check_phone_verification(payload: PhoneVerificationCheck, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    user = locked_user(db, user.id)
    attempt = db.scalar(select(PhoneVerificationAttempt).where(PhoneVerificationAttempt.id == payload.attempt_id,
        PhoneVerificationAttempt.user_id == user.id).with_for_update())
    if not attempt: raise HTTPException(404, "Verification request not found")
    if attempt.status == "APPROVED" and user.verified_phone_number == attempt.phone_number and user.phone_verified_at:
        return user
    if attempt.status != "PENDING" or not attempt.provider_reference:
        raise HTTPException(409, "This verification request is no longer active. Request a new code.")
    if attempt.expires_at <= datetime.now(timezone.utc):
        attempt.status = "EXPIRED"; db.commit()
        raise HTTPException(409, "The verification code has expired. Request a new code.")
    if attempt.check_attempts >= CHECK_LIMIT:
        attempt.status = "LOCKED"; db.commit()
        raise HTTPException(429, "Too many code attempts. Request a new code later.")
    if attempt.provider != settings.phone_verification_provider.upper():
        raise HTTPException(503, "Verification service changed. Request a new code.")
    provider = provider_or_503()
    credential = payload.firebase_id_token if attempt.provider == "FIREBASE" else payload.code
    if not credential:
        raise HTTPException(422, "Verification credential is required.")
    attempt.check_attempts += 1
    attempt_id = attempt.id; phone = attempt.phone_number; reference = attempt.provider_reference
    db.commit()
    try:
        result = provider.check(phone, reference, credential)
    except ProviderUnavailable as exc:
        raise HTTPException(503, "Unable to check the verification code. Please try again.") from exc
    user = locked_user(db, user.id)
    attempt = db.scalar(select(PhoneVerificationAttempt).where(PhoneVerificationAttempt.id == attempt_id,
        PhoneVerificationAttempt.user_id == user.id).with_for_update().execution_options(populate_existing=True))
    if attempt.status == "APPROVED" and user.verified_phone_number == phone and user.phone_verified_at:
        return user
    if attempt.status != "PENDING" or attempt.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(409, "This verification request is no longer active. Request a new code.")
    if (result.status != "approved" or result.phone_number != phone
            or (attempt.provider == "FIREBASE" and (result.auth_time is None
                or result.auth_time < int(attempt.created_at.timestamp())))):
        if result.status in {"expired", "canceled", "max_attempts_reached", "failed"}:
            attempt.status = "EXPIRED"; db.commit()
            raise HTTPException(409, "The verification code is no longer active. Request a new code.")
        raise HTTPException(400, "Incorrect verification code.")
    user.verified_phone_number = phone
    user.claimed_phone_number = phone
    user.phone_verified_at = datetime.now(timezone.utc)
    attempt.status = "APPROVED"
    try:
        db.commit(); db.refresh(user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "This verified phone number is already associated with another account.") from exc
    return user
