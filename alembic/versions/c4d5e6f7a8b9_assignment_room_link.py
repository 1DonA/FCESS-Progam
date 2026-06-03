"""assignment_room_link

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-05-24 00:00:00.000000

Adds room_id (nullable FK -> classrooms) and notes columns to
faculty_course_assignments so each lecturer-course pair can be pinned to
a specific room. The endpoint validates lab-vs-lecture room types.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('faculty_course_assignments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('room_id', sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column('notes', sa.String(length=255), nullable=True))
        batch_op.create_foreign_key(
            'fk_fca_room_id', 'classrooms', ['room_id'], ['id'], ondelete='SET NULL',
        )
        batch_op.create_index('ix_fca_room_id', ['room_id'])


def downgrade() -> None:
    with op.batch_alter_table('faculty_course_assignments', schema=None) as batch_op:
        batch_op.drop_index('ix_fca_room_id')
        batch_op.drop_constraint('fk_fca_room_id', type_='foreignkey')
        batch_op.drop_column('notes')
        batch_op.drop_column('room_id')
