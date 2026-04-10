from datetime import datetime, timedelta

BOX_INTERVALS: dict[int, int] = {
    0: 0,
    1: 1,
    2: 2,
    3: 4,
    4: 7,
    5: 14,
    6: 30,
}

MAX_BOX = 6


def get_next_review_date(box_level: int) -> datetime:
    interval = BOX_INTERVALS.get(box_level, 30)
    return datetime.utcnow() + timedelta(days=interval)


def process_answer(current_box: int, correct: bool) -> tuple[int, datetime]:
    if correct:
        new_box = min(current_box + 1, MAX_BOX)
    else:
        new_box = 0
    return new_box, get_next_review_date(new_box)
