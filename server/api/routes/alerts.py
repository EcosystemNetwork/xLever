from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Alert, AlertStatus, User
from ..schemas import AlertCreate, AlertOut

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.post("/{wallet_address}", response_model=AlertOut)
async def create_alert(
    wallet_address: str, body: AlertCreate, db: AsyncSession = Depends(get_db)
):
    addr = wallet_address.lower()
    result = await db.execute(select(User).where(User.wallet_address == addr))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found — connect wallet first")

    alert = Alert(
        user_id=user.id,
        wallet_address=addr,
        alert_type=body.alert_type,
        asset=body.asset.upper() if body.asset else None,
        threshold=body.threshold,
        message=body.message,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.get("/{wallet_address}", response_model=list[AlertOut])
async def get_alerts(
    wallet_address: str,
    status: AlertStatus | None = AlertStatus.ACTIVE,
    db: AsyncSession = Depends(get_db),
):
    addr = wallet_address.lower()
    query = select(Alert).where(Alert.wallet_address == addr)
    if status:
        query = query.where(Alert.status == status)
    query = query.order_by(Alert.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.delete("/{alert_id}")
async def dismiss_alert(alert_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")

    alert.status = AlertStatus.DISMISSED
    await db.commit()
    return {"ok": True}
