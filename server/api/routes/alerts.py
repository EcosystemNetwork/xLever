# APIRouter groups alert endpoints; Depends injects DB; HTTPException for errors; Query validates params
from fastapi import APIRouter, Depends, HTTPException, Query
# select builds SQL queries for fetching alerts and users
from sqlalchemy import select
# AsyncSession type for the injected DB session
from sqlalchemy.ext.asyncio import AsyncSession

# get_db yields a scoped async DB session per request
from ..database import get_db
# Alert ORM model and status enum for DB operations, User for ownership validation
from ..models import Alert, AlertStatus, User
# Request/response schemas for alert creation and serialization
from ..schemas import AlertCreate, AlertOut

# Prefix all routes with /alerts; tag groups them in Swagger docs
router = APIRouter(prefix="/alerts", tags=["alerts"])


# POST /api/alerts/{wallet_address} — create a new alert for a wallet
@router.post("/{wallet_address}", response_model=AlertOut)
async def create_alert(
    wallet_address: str, body: AlertCreate, db: AsyncSession = Depends(get_db)
):
    # Normalize to lowercase because wallet addresses are stored in lowercase
    addr = wallet_address.lower()
    # Verify the user exists — alerts must belong to a registered wallet
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    # Require wallet registration before creating alerts (enforces FK constraint)
    if not user:
        raise HTTPException(404, "User not found — connect wallet first")

    # Create the alert record with all fields from the request body
    alert = Alert(
        user_id=user.id,                                      # Link to the user's surrogate key
        wallet_address=addr,                                   # Denormalized for direct wallet queries
        alert_type=body.alert_type,                            # Condition type (price_above, health_below, etc.)
        asset=body.asset.upper() if body.asset else None,      # Normalize to uppercase; null for global alerts
        threshold=body.threshold,                              # Numeric trigger value
        message=body.message,                                  # Optional user note displayed on trigger
    )
    # Add the new alert to the session for insertion
    db.add(alert)
    # Persist to the database so it gets an auto-generated ID and created_at
    await db.commit()
    # Refresh to load server-generated fields (id, created_at, status default)
    await db.refresh(alert)
    # Return the newly created alert — FastAPI serializes it via AlertOut schema
    return alert


# GET /api/alerts/{wallet_address} — list alerts for a wallet, filtered by status
@router.get("/{wallet_address}", response_model=list[AlertOut])
async def get_alerts(
    wallet_address: str,
    status: AlertStatus | None = AlertStatus.ACTIVE,  # Default to active-only since triggered/dismissed are historical
    db: AsyncSession = Depends(get_db),
):
    # Normalize to lowercase for consistent DB lookups
    addr = wallet_address.lower()
    # Base query filters by wallet address
    query = select(Alert).where(Alert.wallet_address == addr)
    # Apply status filter if provided — default is ACTIVE so the dashboard shows current alerts
    if status:
        query = query.where(Alert.status == status)
    # Newest alerts first — most relevant alerts are usually the most recent
    query = query.order_by(Alert.created_at.desc())

    # Execute the query and return all matching alerts
    result = await db.execute(query)
    return result.scalars().all()


# DELETE /api/alerts/{alert_id} — dismiss (soft-delete) an alert by changing its status
@router.delete("/{alert_id}")
async def dismiss_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    # Look up the alert by ID
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    # 404 if the alert doesn't exist — prevents confusing success responses for invalid IDs
    if not alert:
        raise HTTPException(404, "Alert not found")

    # Soft-delete by setting status to DISMISSED — preserves audit trail instead of hard deleting
    alert.status = AlertStatus.DISMISSED
    # Persist the status change
    await db.commit()
    # Return confirmation — lightweight response since the alert is dismissed, not fetched
    return {"ok": True}
