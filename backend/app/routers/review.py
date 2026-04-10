import random
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..schemas.review import AnswerIn, AnswerOut, ReviewWordOut
from ..services.spaced_repetition import process_answer

router = APIRouter(prefix="/review", tags=["review"])

EXERCISE_TYPES = ["write", "multiple_choice"]


@router.get("", response_model=List[ReviewWordOut])
def get_review_words(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    due = (
        db.query(UserWord)
        .filter(
            UserWord.user_id == current_user.id,
            UserWord.next_review_date <= now,
        )
        .options(joinedload(UserWord.word))
        .limit(limit)
        .all()
    )

    # Unique significados as distractors pool
    all_significados = list(
        {w.significado for w in db.query(Word.significado).limit(200).all()}
    )

    result: List[ReviewWordOut] = []
    for uw in due:
        exercise_type = random.choice(EXERCISE_TYPES)
        choices = None

        if exercise_type == "multiple_choice":
            wrong = [s for s in all_significados if s != uw.word.significado]
            if len(wrong) >= 3:
                wrong_choices = random.sample(wrong, 3)
                choices = wrong_choices + [uw.word.significado]
                random.shuffle(choices)
            else:
                exercise_type = "write"

        result.append(
            ReviewWordOut(
                user_word_id=uw.id,
                word_id=uw.word_id,
                palabra=uw.word.palabra,
                significado=uw.word.significado,
                idioma_origen=uw.word.idioma_origen,
                idioma_destino=uw.word.idioma_destino,
                box_level=uw.box_level,
                audio_url=uw.word.audio_url,
                exercise_type=exercise_type,
                choices=choices,
            )
        )

    return result


@router.post("/answer", response_model=AnswerOut)
def submit_answer(
    answer: AnswerIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_word = db.query(UserWord).filter(
        UserWord.id == answer.user_word_id,
        UserWord.user_id == current_user.id,
    ).first()
    if not user_word:
        raise HTTPException(status_code=404, detail="Word not found")

    new_box, next_date = process_answer(user_word.box_level, answer.correct)
    user_word.box_level = new_box
    user_word.next_review_date = next_date
    user_word.last_reviewed = datetime.utcnow()
    db.commit()

    msg = f"Correcto! → Caja {new_box}" if answer.correct else "Incorrecto → Caja 0"
    return AnswerOut(
        user_word_id=user_word.id,
        new_box_level=new_box,
        next_review_date=next_date.isoformat(),
        message=msg,
    )
