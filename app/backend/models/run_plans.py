from core.database import Base
from datetime import datetime as PyDateTime
from typing import Optional
from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column


class Run_plans(Base):
    __tablename__ = "run_plans"
    __table_args__ = {"extend_existing": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    plan: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now)
    updated_at: Mapped[Optional[PyDateTime]] = mapped_column(DateTime(timezone=True), default=PyDateTime.now, onupdate=PyDateTime.now)