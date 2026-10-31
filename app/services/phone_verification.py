"""Phone verification using Firebase ID tokens or an isolated test provider."""
import os
import threading
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass
from app.core.config import settings


class ProviderUnavailable(Exception):
    pass


@dataclass(frozen=True)
class VerificationResult:
    status: str
    phone_number: str
    auth_time: int | None = None


_firebase_app_lock = threading.Lock()


class FirebasePhoneProvider:
    def __init__(self, project_id: str):
        if not project_id or os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
            raise ProviderUnavailable("Phone verification is not configured")
        self.project_id = project_id

    def _app(self):
        import firebase_admin
        from firebase_admin import credentials
        with _firebase_app_lock:
            try:
                return firebase_admin.get_app('phone-verification')
            except ValueError:
                return firebase_admin.initialize_app(credentials.ApplicationDefault(), {'projectId': self.project_id}, name='phone-verification')

    def start(self, phone_number: str) -> str:
        # Fail before the browser sends an SMS if the backend cannot load its credentials.
        try:
            self._app().credential.get_credential()
        except Exception as exc:
            raise ProviderUnavailable("Firebase authentication is unavailable") from exc
        return str(uuid.uuid4())

    def check(self, phone_number: str, provider_reference: str, token: str) -> VerificationResult:
        try:
            from firebase_admin import auth
        except ImportError as exc:
            raise ProviderUnavailable("Firebase authentication is unavailable") from exc
        try:
            claims = auth.verify_id_token(token, app=self._app())
        except (ValueError, auth.InvalidIdTokenError):
            return VerificationResult('pending', phone_number)
        except Exception as exc:
            raise ProviderUnavailable("Unable to verify Firebase authentication") from exc
        firebase = claims.get('firebase')
        auth_time = claims.get('auth_time')
        if (not isinstance(firebase, dict) or firebase.get('sign_in_provider') != 'phone'
                or claims.get('phone_number') != phone_number or type(auth_time) is not int
                or auth_time > int(datetime.now(timezone.utc).timestamp())):
            return VerificationResult('pending', phone_number)
        return VerificationResult('approved', phone_number, auth_time)


class TestPhoneProvider:
    def start(self, phone_number: str) -> str:
        return f'test-{uuid.uuid4()}'

    def check(self, phone_number: str, provider_reference: str, code: str) -> VerificationResult:
        return VerificationResult('approved' if code == '123456' else 'pending', phone_number)


def get_phone_provider():
    provider = settings.phone_verification_provider.upper()
    if provider == 'FIREBASE':
        return FirebasePhoneProvider(settings.firebase_project_id)
    if provider == 'TEST' and settings.app_environment.lower() == 'test':
        return TestPhoneProvider()
    raise ProviderUnavailable("Phone verification is unavailable. Contact support.")
