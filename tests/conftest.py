import pytest
from fastapi.testclient import TestClient

from app.core.database import Base, engine
import app.models  # noqa: F401 - imports all models into Base.metadata
from app.main import app


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
