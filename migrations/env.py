from logging.config import fileConfig
from pathlib import Path
import sys
from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic may be invoked from outside the repository root (for example via
# `docker compose exec`). Ensure the application package is always importable.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.database import Base
from app.models import *
config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
# The minimal project alembic.ini does not define logging sections.
if config.config_file_name and config.get_section("formatters"):
    fileConfig(config.config_file_name)
target_metadata = Base.metadata

def run_migrations_offline():
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction(): context.run_migrations()

def run_migrations_online():
    connectable = engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction(): context.run_migrations()

if context.is_offline_mode(): run_migrations_offline()
else: run_migrations_online()
