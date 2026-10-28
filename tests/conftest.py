import os

import pytest
from sqlalchemy.engine import make_url


def configure_test_database():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or not (make_url(url).database or "").endswith("_test"):
        raise pytest.UsageError(
            "Tests require TEST_DATABASE_URL pointing to a dedicated database ending in _test. "
            "Use docker compose --profile test run --rm test."
        )
    os.environ["DATABASE_URL"] = url


# Validate before importing the application or constructing its engine.
configure_test_database()

from fastapi.testclient import TestClient

from alembic import command
from alembic.config import Config
import app.models  # noqa: F401 - imports all models into Base.metadata
from app.main import app


@pytest.fixture(autouse=True)
def reset_database():
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    try:
        yield
    finally:
        command.downgrade(config, "base")


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
