import random
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..schemas.review import AnswerIn, AnswerOut, ReviewWordOut
from ..services.spaced_repetition import process_answer

router = APIRouter(prefix="/review", tags=["review"])


@router.get("", response_model=List[ReviewWordOut])
def get_review_words(
    limit: int = 20,
    boxes: Optional[str] = Query(default=None, description="Comma-separated box levels, e.g. '0,1,2'"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    box_filter = (
        [int(b.strip()) for b in boxes.split(",") if b.strip()]
        if boxes
        else None
    )

    query = (
        db.query(UserWord)
        .filter(
            UserWord.user_id == current_user.id,
            UserWord.next_review_date <= now,
        )
        .options(joinedload(UserWord.word).joinedload(Word.tema))
    )
    if box_filter is not None:
        query = query.filter(UserWord.box_level.in_(box_filter))

    due = query.limit(limit).all()

    # Randomize order so words aren't always reviewed in insertion order
    random.shuffle(due)

    # Build pools by type (word vs phrase) based on significado
    all_sigs = list(
        {w.significado for w in db.query(Word.significado).limit(200).all()}
    )
    word_sigs = [s for s in all_sigs if " " not in s]
    phrase_sigs = [s for s in all_sigs if " " in s]

    result: List[ReviewWordOut] = []
    for uw in due:
        is_phrase = " " in uw.word.palabra or " " in uw.word.significado

        # Phrases always use multiple_choice (typing phrases on mobile is too hard)
        if is_phrase:
            exercise_type = "multiple_choice"
        else:
            exercise_type = random.choice(["write", "multiple_choice"])

        # Build distractor pool matching the type of the correct significado
        if " " in uw.word.significado:
            pool = [s for s in phrase_sigs if s != uw.word.significado]
            if len(pool) < 3:
                pool = [s for s in all_sigs if s != uw.word.significado]
        else:
            pool = [s for s in word_sigs if s != uw.word.significado]
            if len(pool) < 3:
                pool = [s for s in all_sigs if s != uw.word.significado]

        # Always generate choices so mobile users can toggle write → options
        choices = None
        if len(pool) >= 3:
            wrong_choices = random.sample(pool, 3)
            choices = wrong_choices + [uw.word.significado]
            random.shuffle(choices)
        elif exercise_type == "multiple_choice":
            # Not enough distractors — fall back to write
            exercise_type = "write"

        tema_nombre = uw.word.tema.nombre if uw.word.tema else None

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
                tema_nombre=tema_nombre,
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
