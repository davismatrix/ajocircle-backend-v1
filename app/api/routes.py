from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.ajo import router as ajo_router
from app.api.contributions import router as contribution_router
from app.api.payouts import router as payout_router
from app.api.notifications import router as notification_router
router = APIRouter()
router.include_router(auth_router, prefix="/auth", tags=["Authentication"])
router.include_router(ajo_router, prefix="/ajo-groups", tags=["Ajo Groups"])
router.include_router(contribution_router, prefix="/contributions", tags=["Contributions"])
router.include_router(payout_router, prefix="/payouts", tags=["Payouts"])
router.include_router(notification_router, prefix="/notifications", tags=["Notifications"])
