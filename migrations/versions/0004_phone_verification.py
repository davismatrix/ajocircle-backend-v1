from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_phone_verification"
down_revision = "0003_group_creation_requests"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("claimed_phone_number", sa.String(30)))
    op.add_column("users", sa.Column("phone_verified_at", sa.DateTime(timezone=True)))
    # Existing self-reported values must not be treated as proof or reserve a number.
    op.execute("UPDATE users SET claimed_phone_number = phone_number, phone_number = NULL WHERE phone_number IS NOT NULL")
    op.create_table("phone_verification_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("phone_number", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_reference", sa.String(80)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("check_attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_phone_verification_attempts_user_id", "phone_verification_attempts", ["user_id"])
    op.create_index("ix_phone_verification_attempts_phone_number", "phone_verification_attempts", ["phone_number"])


def downgrade():
    # Never discard claimed numbers or violate the old unique constraint silently.
    duplicates = op.get_bind().execute(sa.text("""
        SELECT count(*) FROM (
          SELECT COALESCE(phone_number, claimed_phone_number) AS phone
          FROM users WHERE COALESCE(phone_number, claimed_phone_number) IS NOT NULL
          GROUP BY COALESCE(phone_number, claimed_phone_number) HAVING count(*) > 1
        ) duplicates
    """)).scalar()
    if duplicates:
        raise RuntimeError("Cannot downgrade: duplicate claimed phone numbers must be resolved first")
    op.execute("UPDATE users SET phone_number = COALESCE(phone_number, claimed_phone_number)")
    op.drop_table("phone_verification_attempts")
    op.drop_column("users", "phone_verified_at")
    op.drop_column("users", "claimed_phone_number")
