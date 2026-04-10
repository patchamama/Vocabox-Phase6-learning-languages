"""
Test-mode endpoints — only available when current_user.username == 'test'.

POST /test/simulate  — randomly distributes the user's words across all 7 boxes,
                       setting a realistic mix of "due today" vs. future dates.
POST /test/reset     — moves every word back to box 0, all due right now.
"""
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..services.spaced_repetition import BOX_INTERVALS

router = APIRouter(prefix="/test", tags=["test"])

# Relative probability of a word landing in each box (heavier towards box 0–2,
# matching a realistic vocabulary that is mostly new/in-progress).
_BOX_WEIGHTS = [30, 20, 15, 12, 10, 8, 5]

# Probability that a word in a given box is already due today.
# Higher boxes review less often, so fewer are due on any given day.
_PENDING_PROB = [0.70, 0.50, 0.35, 0.25, 0.15, 0.10, 0.05]


def _require_test(user: User) -> None:
    if user.username.lower() != "test":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Test mode is only available for the 'test' user",
        )


@router.post("/simulate")
def simulate_daily_use(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Distribute words across boxes with a realistic daily-use spread."""
    _require_test(current_user)

    user_words = (
        db.query(UserWord).filter(UserWord.user_id == current_user.id).all()
    )
    if not user_words:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No words to simulate with — add some words first",
        )

    now = datetime.utcnow()

    for uw in user_words:
        box = random.choices(range(7), weights=_BOX_WEIGHTS, k=1)[0]
        uw.box_level = box
        interval_days = BOX_INTERVALS[box]

        if random.random() < _PENDING_PROB[box]:
            # Due right now (0–2 hours in the past)
            uw.next_review_date = now - timedelta(minutes=random.randint(0, 120))
            uw.last_reviewed = now - timedelta(days=max(1, interval_days))
        else:
            # Due sometime in the future within this box's interval
            days_ahead = random.randint(1, max(2, interval_days))
            uw.next_review_date = now + timedelta(days=days_ahead)
            uw.last_reviewed = now - timedelta(hours=random.randint(2, 48))

    db.commit()
    return {"ok": True, "words": len(user_words)}


@router.post("/reset")
def reset_all_to_box_zero(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset every word to box 0, all due immediately."""
    _require_test(current_user)

    now = datetime.utcnow()
    user_words = (
        db.query(UserWord).filter(UserWord.user_id == current_user.id).all()
    )
    for uw in user_words:
        uw.box_level = 0
        uw.next_review_date = now
        uw.last_reviewed = None

    db.commit()
    return {"ok": True, "words": len(user_words)}
