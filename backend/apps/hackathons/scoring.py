"""Turns judges' scores into a leaderboard."""

from __future__ import annotations

from apps.hackathons.models import Hackathon, Submission


def leaderboard(hackathon: Hackathon) -> list[dict]:
    """Rank the hackathon's submissions.

    A judge's evaluation is worth the weighted share of the marks they gave, as
    a percentage: sum(value / max_score * weight) / sum(weight) * 100. A
    submission's score is the mean of its evaluations. Equal scores share a rank.
    """
    criteria = {c.id: c for c in hackathon.criteria.all()}
    total_weight = sum(c.weight for c in criteria.values())
    submissions = (
        Submission.objects.filter(team__hackathon=hackathon)
        .select_related("team", "challenge")
        .prefetch_related("evaluations__scores")
    )
    rows = []
    for submission in submissions:
        totals = []
        for evaluation in submission.evaluations.all():
            earned = sum(
                score.value / criteria[score.criterion_id].max_score
                * criteria[score.criterion_id].weight
                for score in evaluation.scores.all()
                if score.criterion_id in criteria
            )
            if total_weight:
                totals.append(earned / total_weight * 100)
        rows.append(
            {
                "submission": submission,
                "score": round(sum(totals) / len(totals), 2) if totals else None,
                "evaluations": len(totals),
            }
        )
    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0), r["submission"].submitted_at))
    rank, previous = 0, object()
    for position, row in enumerate(rows, start=1):
        if row["score"] != previous:
            rank, previous = position, row["score"]
        row["rank"] = rank if row["score"] is not None else None
    return rows
