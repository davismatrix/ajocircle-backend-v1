from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    invitation_expire_hours: int = 168
    notification_provider: str = "LOG"
    cors_origins: str = "http://localhost:3000"
    app_environment: str = "development"
    phone_verification_provider: str = "DISABLED"
    firebase_project_id: str = ""
    phone_verification_requests_per_hour: int = Field(default=5, ge=1, le=1000)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
