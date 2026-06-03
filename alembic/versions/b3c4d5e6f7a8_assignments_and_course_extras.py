"""assignments_and_course_extras

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-05-21 00:00:00.000000

Adds:
  - faculty_course_assignments table (lecturer ↔ course ↔ department link, FR-13)
  - course_type and workload columns on courses (curriculum metadata)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. New columns on courses (nullable so existing rows survive the migration).
    with op.batch_alter_table('courses', schema=None) as batch_op:
        batch_op.add_column(sa.Column('course_type', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('workload', sa.Numeric(precision=4, scale=2), nullable=True))

    # 2. faculty ↔ course assignment table.
    op.create_table(
        'faculty_course_assignments',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('faculty_id', sa.Uuid(), nullable=False),
        sa.Column('course_id', sa.Uuid(), nullable=False),
        sa.Column('department_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['faculty_id'], ['faculties.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('faculty_id', 'course_id', name='uq_faculty_course'),
    )
    with op.batch_alter_table('faculty_course_assignments', schema=None) as batch_op:
        batch_op.create_index('ix_fca_faculty_id', ['faculty_id'])
        batch_op.create_index('ix_fca_course_id', ['course_id'])
        batch_op.create_index('ix_fca_department_id', ['department_id'])


def downgrade() -> None:
    with op.batch_alter_table('faculty_course_assignments', schema=None) as batch_op:
        batch_op.drop_index('ix_fca_department_id')
        batch_op.drop_index('ix_fca_course_id')
        batch_op.drop_index('ix_fca_faculty_id')
    op.drop_table('faculty_course_assignments')

    with op.batch_alter_table('courses', schema=None) as batch_op:
        batch_op.drop_column('workload')
        batch_op.drop_column('course_type')
