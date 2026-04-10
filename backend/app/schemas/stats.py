from typing import List

from pydantic import BaseModel


class BoxStats(BaseModel):
    box: int
    count: int


class StatsOut(BaseModel):
    total_words: int
    pending_today: int
    streak: int
    accuracy: float
    boxes: List[BoxStats]
