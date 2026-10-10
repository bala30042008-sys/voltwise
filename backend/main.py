
import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pwdlib import PasswordHash
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import Base, engine, get_db
from models import Reading, User


# ---------- SECURITY CONFIGURATION ----------

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY or SECRET_KEY == "YOUR_NEW_RANDOM_SECRET":
    raise RuntimeError(
        "Set a new SECRET_KEY in backend/.env before starting the server."
    )

ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60

password_hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)

# Create database tables, including users and readings.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="VoltWise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- REQUEST MODELS ----------

class RegisterInput(BaseModel):
    username: str = Field(
        min_length=3,
        max_length=20,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )
    password: str = Field(min_length=8, max_length=128)


class LoginInput(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class ReadingInput(BaseModel):
    # Kept for compatibility with the current frontend.
    # The server uses the authenticated username instead.
    username: str = Field(min_length=1, max_length=50)
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=0, le=11)
    units: float = Field(ge=0, le=100000)


# ---------- AUTHENTICATION HELPERS ----------

def create_access_token(username: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(
        minutes=TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": username,
        "exp": expires,
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Please log in first.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        username = payload.get("sub")

        if not username:
            raise HTTPException(
                status_code=401,
                detail="Invalid access token.",
            )

    except jwt.PyJWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter_by(username=username).first()

    if user is None:
        raise HTTPException(status_code=401, detail="User not found.")

    return user


# ---------- REGISTER ----------

@app.post("/auth/register", status_code=201)
def register(
    details: RegisterInput,
    db: Session = Depends(get_db),
):
    username = details.username.strip().lower()

    existing_user = db.query(User).filter_by(
        username=username
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Username already registered.",
        )

    user = User(
        username=username,
        password_hash=password_hasher.hash(details.password),
    )

    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Username already registered.",
        )

    return {
        "message": "Registration successful.",
        "username": user.username,
    }


# ---------- LOGIN ----------

@app.post("/auth/login")
def login(
    details: LoginInput,
    db: Session = Depends(get_db),
):
    username = details.username.strip().lower()

    user = db.query(User).filter_by(
        username=username
    ).first()

    if not user or not password_hasher.verify(
        details.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password.",
        )

    token = create_access_token(user.username)

    return {
        "access_token": token,
        "token_type": "bearer",
        "username": user.username,
    }


# ---------- BASIC ROUTES ----------

@app.get("/")
def home():
    return {"message": "VoltWise backend is running!"}


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- BILL CALCULATOR ----------

SLABS = [
    (100, 0),
    (200, 4.70),
    (400, 4.95),
    (500, 6.65),
    (600, 8.40),
    (800, 9.45),
    (1000, 10.50),
    (float("inf"), 11.55),
]


def calculate_bill(units: float) -> float:
    if units < 0:
        raise ValueError("Units cannot be negative")

    remaining = units
    previous_limit = 0
    total = 0.0

    for limit, rate in SLABS:
        slab_units = min(remaining, limit - previous_limit)

        if slab_units > 0:
            total += slab_units * rate
            remaining -= slab_units

        previous_limit = limit

        if remaining <= 0:
            break

    return round(total, 2)


@app.get("/calculate")
def calculate(units: float = Query(ge=0, le=100000)):
    return {
        "units": units,
        "estimated_bill": calculate_bill(units),
        "currency": "INR",
    }


# ---------- MONTHLY READING ROUTES ----------

@app.post("/readings")
def save_reading(
    reading: ReadingInput,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Never trust the username supplied by the browser.
    username = current_user.username

    existing = db.query(Reading).filter_by(
        username=username,
        year=reading.year,
        month=reading.month,
    ).first()

    bill = calculate_bill(reading.units)

    if existing:
        existing.units = reading.units
        existing.bill = bill
        db.commit()
        db.refresh(existing)

        return {
            "message": "Reading updated",
            "reading": reading_to_dict(existing),
        }

    new_reading = Reading(
        username=username,
        year=reading.year,
        month=reading.month,
        units=reading.units,
        bill=bill,
    )

    db.add(new_reading)
    db.commit()
    db.refresh(new_reading)

    return {
        "message": "Reading saved",
        "reading": reading_to_dict(new_reading),
    }


@app.get("/readings/{username}/{year}")
def get_readings(
    username: str,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if username.strip().lower() != current_user.username:
        raise HTTPException(
            status_code=403,
            detail="You cannot access another user's readings.",
        )

    readings = db.query(Reading).filter_by(
        username=current_user.username,
        year=year,
    ).order_by(Reading.month).all()

    return [reading_to_dict(item) for item in readings]


@app.delete("/readings/{username}/{year}/{month}")
def delete_reading(
    username: str,
    year: int,
    month: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if username.strip().lower() != current_user.username:
        raise HTTPException(
            status_code=403,
            detail="You cannot delete another user's readings.",
        )

    reading = db.query(Reading).filter_by(
        username=current_user.username,
        year=year,
        month=month,
    ).first()

    if not reading:
        raise HTTPException(
            status_code=404,
            detail="Reading not found.",
        )

    db.delete(reading)
    db.commit()

    return {"message": "Reading deleted"}


def reading_to_dict(reading: Reading):
    return {
        "username": reading.username,
        "year": reading.year,
        "month": reading.month,
        "units": reading.units,
        "bill": reading.bill,
    }
