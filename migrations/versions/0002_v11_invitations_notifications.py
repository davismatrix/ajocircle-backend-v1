from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_v11_invites_notifications"
down_revision = "0001_initial"
branch_labels = None
depends_on = None
U = postgresql.UUID(as_uuid=True)


def upgrade():
    op.add_column("users", sa.Column("role", sa.String(30), server_default="USER", nullable=False))
    op.create_table(
        "ajo_invitations",
        sa.Column("id", U, primary_key=True),
        sa.Column("ajo_group_id", U, sa.ForeignKey("ajo_groups.id"), nullable=False),
        sa.Column("phone_number", sa.String(30), nullable=False),
        sa.Column("role", sa.String(30), server_default="MEMBER", nullable=False),
        sa.Column("payout_position", sa.Integer()),
        sa.Column("token", U, unique=True, nullable=False),
        sa.Column("status", sa.String(30), server_default="PENDING", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("invited_by", U, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("accepted_by", U, sa.ForeignKey("users.id")),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ajo_invitations_ajo_group_id", "ajo_invitations", ["ajo_group_id"])
    op.create_index("ix_ajo_invitations_phone_number", "ajo_invitations", ["phone_number"])
    op.create_index("ix_ajo_invitations_token", "ajo_invitations", ["token"])
    op.create_table(
        "notifications",
        sa.Column("id", U, primary_key=True),
        sa.Column("user_id", U, sa.ForeignKey("users.id")),
        sa.Column("phone_number", sa.String(30)),
        sa.Column("ajo_group_id", U, sa.ForeignKey("ajo_groups.id")),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("channel", sa.String(30), server_default="IN_APP", nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB),
        sa.Column("status", sa.String(30), server_default="PENDING", nullable=False),
        sa.Column("provider_reference", sa.String(255)),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_phone_number", "notifications", ["phone_number"])
    op.create_index("ix_notifications_ajo_group_id", "notifications", ["ajo_group_id"])


def downgrade():
    op.drop_table("notifications")
    op.drop_table("ajo_invitations")
    op.drop_column("users", "role")
