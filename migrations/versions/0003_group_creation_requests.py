from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_group_creation_requests"
down_revision = "0002_v11_invites_notifications"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ajo_creation_requests",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("request_key", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("ajo_group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ajo_groups.id"), unique=True, nullable=False),
    )


def downgrade():
    op.drop_table("ajo_creation_requests")
