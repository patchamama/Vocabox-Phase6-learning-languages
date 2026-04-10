from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..schemas.stats import BoxStats, StatsOut

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    all_uw = db.query(UserWord).filter(UserWord.user_id == current_user.id).all()

    total_words = len(all_uw)
    pending_today = sum(1 for uw in all_uw if uw.next_review_date <= now)

    boxes: List[BoxStats] = [
        BoxStats(box=b, count=sum(1 for uw in all_uw if uw.box_level == b))
        for b in range(7)
    ]

    return StatsOut(
        total_words=total_words,
        pending_today=pending_today,
        streak=0,      # requires separate daily-review tracking (v2)
        accuracy=0.0,  # requires answer history tracking (v2)
        boxes=boxes,
    )
