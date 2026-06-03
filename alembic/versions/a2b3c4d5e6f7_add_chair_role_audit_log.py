"""add_chair_role_audit_log_user_fields

Revision ID: a2b3c4d5e6f7
Revises: d1d07f806e17
Create Date: 2026-05-19 00:00:00.000000

Adds:
  - CHAIR value to user_role enum (FR-8.2)
  - faculty_id and department_id columns to users (for role-scoped access FR-8.4)
  - audit_logs table (FR-8.4 audit trail)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'd1d07f806e17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite does not support ALTER TYPE, so we recreate the users table
    # with the updated enum inline (SQLite stores enums as VARCHAR).
    # For PostgreSQL this would use: op.execute("ALTER TYPE user_role ADD VALUE 'CHAIR'")
    # Here we use batch_alter_table which works for both.
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('faculty_id', sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column('department_id', sa.Uuid(), nullable=True))
        # SQLite: role column recreated to accept 'CHAIR' as valid value
        batch_op.alter_column(
            'role',
            existing_type=sa.Enum('ADMIN', 'FACULTY', name='user_role'),
            type_=sa.Enum('ADMIN', 'CHAIR', 'FACULTY', name='user_role'),
            existing_nullable=False,
        )

    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('user_email', sa.String(), nullable=True),
        sa.Column('action', sa.String(length=100), nullable=False),
        sa.Column('resource_type', sa.String(length=50), nullable=False),
        sa.Column('resource_id', sa.String(), nullable=True),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('audit_logs')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('department_id')
        batch_op.drop_column('faculty_id')
        batch_op.alter_column(
            'role',
            existing_type=sa.Enum('ADMIN', 'CHAIR', 'FACULTY', name='user_role'),
            type_=sa.Enum('ADMIN', 'FACULTY', name='user_role'),
            existing_nullable=False,
        )
