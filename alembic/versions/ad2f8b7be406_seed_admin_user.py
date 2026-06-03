from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = 'your_revision_id'
down_revision = 'previous_revision_id'
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    session = Session(bind=bind)

    users_table = sa.Table(
        'users',
        sa.MetaData(),
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('username', sa.String, unique=True),
        sa.Column('password', sa.String),
        sa.Column('is_admin', sa.Boolean),
    )

    # Insert admin user
    session.execute(
        users_table.insert().values(
            username="admin",
            password="$2b$12$abc123...",  # bcrypt hash of "admin1234"
            is_admin=True
        )
    )
    session.commit()

def downgrade():
    bind = op.get_bind()
    session = Session(bind=bind)
    users_table = sa.Table(
        'users',
        sa.MetaData(),
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('username', sa.String, unique=True),
        sa.Column('password', sa.String),
        sa.Column('is_admin', sa.Boolean),
    )
    session.execute(users_table.delete().where(users_table.c.username == "admin"))
    session.commit()
