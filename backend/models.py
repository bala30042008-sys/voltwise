
from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    UniqueConstraint,
)
from database import Base


class Reading(Base):
    __tablename__ = "readings"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), nullable=False, index=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    units = Column(Float, nullable=False)
    bill = Column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "username",
            "year",
            "month",
            name="unique_user_month",
        ),
    )


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
