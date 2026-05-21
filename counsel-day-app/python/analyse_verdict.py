#!/usr/bin/env python3
"""
analyse_verdict.py · Counsel.day premium-report NLP layer.

Invoked from src/jobs/cron.ts verdictGenerate after the Anthropic call
completes. Reads verdict + vote data on stdin as JSON, writes the full
analysis payload on stdout as JSON. Stored in verdicts.analysis_json.

Input shape:
    {
        "decision": {
            "id": "...",
            "question": "...",
            "format": "strong_lean",
            "duration_days": 7,
            "tier": "couple",
            "starts_at": "2026-05-15T19:00:00Z",
            "unseals_at": "2026-05-21T19:00:00Z"
        },
        "participants": [
            {"display_name": "James", "position": 1},
            {"display_name": "Alexandra", "position": 2}
        ],
        "votes": [
            {"display_name": "James", "vote_date": "2026-05-15",
             "direction": "lean_yes", "conviction": null,
             "note": "The job offer is real and the timing is good."},
            ...
        ],
        "ai_themes": [...]            # optional · parsed from the fenced JSON
                                      # block in the verdict prose
    }

Output shape · see migrations/0011 header comment for the canonical
list. Versioned via the "version" field at the top of the result.

Dependencies (one-time install on the box):
    pip install vaderSentiment==3.3.2 spacy==3.7.2
    python -m spacy download en_core_web_sm

Failure mode: this script must NEVER raise an unhandled exception · it
writes {"version": 1, "error": "..."} to stdout and exits 0 so the cron
keeps moving. The verdict prose is the load-bearing part; the analysis
is a premium overlay and degrading to "report unavailable for this
decision" is acceptable.
"""

import json
import sys
from collections import Counter, defaultdict
from typing import Any

VERSION = 1

DIRECTION_SCORE = {
    "strong_yes": 2, "lean_yes": 1, "neutral": 0,
    "lean_no": -1, "strong_no": -2, "skip": 0,
}

# Words to drop from per-partner clouds. Counsel.day-specific additions
# on top of standard stopwords (the decision question's own nouns add no
# information about what each partner THINKS about it).
STOPWORDS_EXTRA = {
    "yes", "no", "lean", "strong", "vote", "voted",
    "decision", "day", "today", "tonight", "evening",
    "really", "actually", "still", "just", "even", "much",
}

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    _vader = SentimentIntensityAnalyzer()
except Exception:
    _vader = None

try:
    import spacy
    _nlp = spacy.load("en_core_web_sm", disable=["ner", "parser"])
except Exception:
    _nlp = None


def vader_compound(text: str) -> float:
    """Sentiment in [-1, +1]. Returns 0.0 if VADER is unavailable or text empty."""
    if not _vader or not text:
        return 0.0
    return _vader.polarity_scores(text)["compound"]


def vader_label(score: float) -> str:
    if score >= 0.35:  return "positive"
    if score <= -0.35: return "negative"
    return "neutral"


def tokenise(text: str) -> list[str]:
    """Lowercased lemmas. Drops stopwords, punctuation, numerics. Falls back
    to a naive split if spaCy isn't loaded."""
    if not text:
        return []
    if _nlp is None:
        # Naive fallback · still useful for the JS bundle if spaCy missing.
        toks = [t.lower().strip(".,;:!?\"'") for t in text.split()]
        return [t for t in toks if t and t.isalpha() and len(t) > 2 and t not in STOPWORDS_EXTRA]
    doc = _nlp(text)
    out = []
    for t in doc:
        if t.is_stop or t.is_punct or t.is_space or not t.is_alpha:
            continue
        lemma = t.lemma_.lower()
        if len(lemma) < 3 or lemma in STOPWORDS_EXTRA:
            continue
        out.append(lemma)
    return out


def safe_main() -> int:
    """Wrapper that ensures we always exit 0 with valid JSON on stdout,
    so the calling cron in cron.ts can rely on parsing succeeding."""
    try:
        return main()
    except Exception as e:  # broad on purpose · this is non-fatal infrastructure
        sys.stdout.write(json.dumps({
            "version": VERSION,
            "error": f"{type(e).__name__}: {e}",
        }))
        return 0


def main() -> int:
    raw = sys.stdin.read()
    if not raw:
        sys.stdout.write(json.dumps({"version": VERSION, "error": "empty stdin"}))
        return 0

    data = json.loads(raw)
    decision = data.get("decision", {})
    participants = data.get("participants", [])
    votes = data.get("votes", [])
    ai_themes = data.get("ai_themes", []) or []

    # ---------- per-partner buckets ----------
    by_partner: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for v in votes:
        by_partner[v["display_name"]].append(v)
    for name in by_partner:
        by_partner[name].sort(key=lambda r: r["vote_date"])

    # ---------- vote_matrix · one row per evening, columns by partner ----------
    dates_in_order: list[str] = sorted({v["vote_date"] for v in votes})
    vote_matrix = []
    for i, d in enumerate(dates_in_order):
        cells = []
        for p in participants:
            name = p["display_name"]
            cell = next((v for v in by_partner.get(name, []) if v["vote_date"] == d), None)
            if cell is None:
                cells.append({"display_name": name, "direction": "skip",
                              "score": 0, "note": None})
            else:
                cells.append({
                    "display_name": name,
                    "direction": cell["direction"],
                    "score": DIRECTION_SCORE.get(cell["direction"], 0),
                    "note": cell.get("note") or None,
                })
        vote_matrix.append({"vote_date": d, "day_index": i + 1, "participants": cells})

    # ---------- trajectory · scores by partner by day ----------
    trajectory = []
    for row in vote_matrix:
        scores = {c["display_name"]: c["score"] for c in row["participants"]}
        trajectory.append({
            "day_index": row["day_index"],
            "vote_date": row["vote_date"],
            "scores": scores,
        })

    # ---------- per-participant analysis ----------
    p_out = []
    partner_tokens_by_name: dict[str, list[str]] = {}
    for p in participants:
        name = p["display_name"]
        their_votes = by_partner.get(name, [])
        counts = Counter(v["direction"] for v in their_votes)
        scored = [(DIRECTION_SCORE.get(v["direction"], 0), v) for v in their_votes
                  if v["direction"] != "skip"]
        flat = sum(s for s, _ in scored) / max(1, len(scored)) if scored else 0.0
        # Recency-weighted (matches lib/anthropic + run-verdict route)
        wsum = 0.0
        ws = 0.0
        for i, (s, _v) in enumerate(scored):
            w = i + 1
            wsum += s * w
            ws += w
        weighted = wsum / ws if ws else 0.0

        first_score = scored[0][0] if scored else 0
        last_score = scored[-1][0] if scored else 0

        sentiment_by_day = []
        all_tokens: list[str] = []
        token_sentiment: dict[str, list[float]] = defaultdict(list)
        for v in their_votes:
            note = v.get("note") or ""
            score = vader_compound(note)
            sentiment_by_day.append({
                "day": v["vote_date"],
                "compound": round(score, 3),
                "label": vader_label(score),
                "has_note": bool(note),
            })
            toks = tokenise(note)
            all_tokens.extend(toks)
            for t in toks:
                token_sentiment[t].append(score)

        partner_tokens_by_name[name] = all_tokens

        cloud_counter = Counter(all_tokens)
        cloud = []
        # Top 60 cloud entries · enough for a rich D3 cloud without clutter.
        for word, count in cloud_counter.most_common(60):
            sents = token_sentiment.get(word, [])
            avg_s = sum(sents) / len(sents) if sents else 0.0
            cloud.append({
                "word": word,
                "count": count,
                "weight": count,  # let the renderer scale
                "sentiment": round(avg_s, 3),
            })

        sentiment_avg = (
            sum(s["compound"] for s in sentiment_by_day if s["has_note"])
            / max(1, sum(1 for s in sentiment_by_day if s["has_note"]))
        )

        p_out.append({
            "display_name": name,
            "verdict_word": score_to_word(weighted),
            "flat_score": round(flat, 2),
            "weighted_score": round(weighted, 2),
            "first_score": first_score,
            "last_score": last_score,
            "delta": last_score - first_score,
            "vote_count": sum(1 for v in their_votes if v["direction"] != "skip"),
            "skip_count": counts.get("skip", 0),
            "counts": {k: counts.get(k, 0) for k in
                       ["strong_yes", "lean_yes", "lean_no", "strong_no", "skip"]},
            "sentiment": {
                "average": round(sentiment_avg, 3),
                "by_day": sentiment_by_day,
            },
            "word_cloud": cloud,
            "top_nouns": [w["word"] for w in cloud[:10]],
        })

    # ---------- vocabulary overlap + unique sets ----------
    sets_by_partner = {n: set(toks) for n, toks in partner_tokens_by_name.items()}
    if len(sets_by_partner) >= 2:
        names_ordered = [p["display_name"] for p in participants]
        common = set.intersection(*(sets_by_partner.get(n, set()) for n in names_ordered)) \
            if all(n in sets_by_partner for n in names_ordered) else set()
        partner_only: dict[str, list[str]] = {}
        for n in names_ordered:
            others = set().union(*[sets_by_partner.get(o, set())
                                   for o in names_ordered if o != n])
            unique = sets_by_partner.get(n, set()) - others
            counter = Counter(partner_tokens_by_name.get(n, []))
            partner_only[n] = [w for w, _ in counter.most_common()
                               if w in unique][:15]
        vocabulary_overlap = {
            "common": sorted(common),
            "partner_only": partner_only,
        }
    else:
        vocabulary_overlap = {"common": [], "partner_only": {}}

    # ---------- asymmetries (post-process: pair the top unique nouns) ----------
    asymmetries = []
    if len(participants) >= 2 and vocabulary_overlap["partner_only"]:
        for left in participants:
            left_name = left["display_name"]
            left_words = vocabulary_overlap["partner_only"].get(left_name, [])
            for right in participants:
                right_name = right["display_name"]
                if right_name <= left_name:  # one direction only
                    continue
                right_words = vocabulary_overlap["partner_only"].get(right_name, [])
                # Pair top-1 from each as an asymmetry.
                if left_words and right_words:
                    asymmetries.append({
                        "type": "top_unique_vocabulary",
                        "left": {"partner": left_name, "word": left_words[0]},
                        "right": {"partner": right_name, "word": right_words[0]},
                    })
        # Pull AI-supplied asymmetries through too, if present.
        for t in ai_themes:
            if isinstance(t, dict) and t.get("type") == "asymmetry":
                asymmetries.append(t)

    # ---------- themes · merge AI themes with spaCy-derived top nouns ----------
    themes_out: list[dict[str, Any]] = []
    seen_names = set()
    for t in ai_themes:
        if isinstance(t, dict) and t.get("name"):
            n = str(t["name"]).strip().lower()
            if n in seen_names:
                continue
            seen_names.add(n)
            themes_out.append({
                "name": t["name"],
                "mentions": int(t.get("mentions", 0) or 0),
                "attributed_to": t.get("attributed_to", []) or [],
                "key_quote": t.get("key_quote"),
                "source": "ai",
            })
    # Add top noun-frequency themes if AI didn't supply many.
    if len(themes_out) < 5:
        all_counter: Counter = Counter()
        for toks in partner_tokens_by_name.values():
            all_counter.update(toks)
        for word, mentions in all_counter.most_common(15):
            if word in seen_names:
                continue
            attributed = [n for n, toks in partner_tokens_by_name.items() if word in toks]
            # Find a key quote from the first note that uses this word.
            key_quote = None
            for v in votes:
                note = v.get("note") or ""
                if word in note.lower():
                    key_quote = note
                    break
            themes_out.append({
                "name": word,
                "mentions": mentions,
                "attributed_to": attributed,
                "key_quote": key_quote,
                "source": "frequency",
            })
            if len(themes_out) >= 8:
                break

    # ---------- conviction asymmetry observation ----------
    # If one partner moved a lot more than the other across the period.
    if len(p_out) >= 2:
        deltas = [(p["display_name"], abs(p["delta"])) for p in p_out]
        deltas.sort(key=lambda x: x[1], reverse=True)
        if deltas[0][1] - deltas[-1][1] >= 2:
            asymmetries.append({
                "type": "movement",
                "description": f"{deltas[0][0]} moved by {deltas[0][1]} points; {deltas[-1][0]} moved by {deltas[-1][1]}.",
                "left": {"partner": deltas[0][0], "delta": deltas[0][1]},
                "right": {"partner": deltas[-1][0], "delta": deltas[-1][1]},
            })

    out = {
        "version": VERSION,
        "vote_matrix": vote_matrix,
        "trajectory": trajectory,
        "participants": p_out,
        "themes": themes_out,
        "asymmetries": asymmetries,
        "vocabulary_overlap": vocabulary_overlap,
        "next_conversation_prompt": data.get("next_conversation_prompt"),
        "tools": {
            "vader_loaded": _vader is not None,
            "spacy_loaded": _nlp is not None,
        },
    }
    sys.stdout.write(json.dumps(out))
    return 0


def score_to_word(avg: float) -> str:
    if avg >= 1.5:  return "YES"
    if avg >= 0.5:  return "LEAN YES"
    if avg > -0.5:  return "NEUTRAL"
    if avg > -1.5:  return "LEAN NO"
    return "NO"


if __name__ == "__main__":
    raise SystemExit(safe_main())
