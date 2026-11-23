"""The Compare screen: every labeler's verdict on each (claim, reference paper) of one paper.

A lead sees every pair. Anyone else sees only the pairs they judged themselves, so a blind check
stays blind for the pairs they have not reached yet. A person who rejected a claim has a verdict
on each of its pairs with no level, which disagrees with anyone who gave it one.
"""

from app.labeling.schema import current

Pair = tuple[str, str]  # (claim_id, reference_id)


def verdicts(claims: list[dict], labels: list[dict]) -> dict[Pair, dict[str, dict]]:
    """pair -> account -> that account's verdict, from one paper's `claims` and `labels` rows."""
    status = {(c["claim_id"], c["annotator_id"]): c["status"] for c in current("claims", claims)}
    found: dict[Pair, dict[str, dict]] = {}
    for row in current("labels", labels):
        account = row["annotator_id"]
        if status.get((row["claim_id"], account)) == "rejected":
            continue  # labels saved before the claim was rejected; the export drops them too
        found.setdefault((row["claim_id"], row["reference_id"]), {})[account] = {
            "labeler": row["annotator"],
            "evidence": int(row["evidence"]),
            "confidence": row["confidence"],
            "rationale": row["rationale"],
            "claim_status": status.get((row["claim_id"], account), "accepted"),
            "claim": row["claim"],
        }
    names = {c["annotator_id"]: c["annotator"] for c in current("claims", claims)}
    for (claim_id, account), claim_status in status.items():
        if claim_status != "rejected":
            continue
        for pair in [p for p in found if p[0] == claim_id]:
            found[pair][account] = {
                "labeler": names[account],
                "evidence": None,
                "confidence": "",
                "rationale": "",
                "claim_status": "rejected",
                "claim": "",
            }
    return found


def may_compare(account: str, lead: bool, claims: list[dict], labels: list[dict]) -> bool:
    """Whether `account` may open the Compare screen of this paper: a lead, or someone who saved."""
    return lead or any(row["annotator_id"] == account for row in (*claims, *labels))


def view(
    session: dict, found: dict[Pair, dict[str, dict]], notes: list[dict], account: str, lead: bool
) -> dict:
    """The Compare screen of one paper for `account`: disagreements first, then agreements, then
    pairs only one person labeled. Within a pair the viewer's own verdict comes first."""
    order = {claim["claim_id"]: index for index, claim in enumerate(session["claims"])}
    text = {claim["claim_id"]: claim["claim"] for claim in session["claims"]}
    titles = {ref["reference_id"]: ref["label"] for ref in session["references"]}
    notes_of: dict[Pair, list[dict]] = {}
    for note in sorted(notes, key=lambda n: n["ts"]):
        notes_of.setdefault((note["claim_id"], note["reference_id"]), []).append(
            {"author": note["annotator"], "ts": note["ts"], "note": note["note"]}
        )

    pairs = []
    for (claim_id, reference_id), by_account in found.items():
        if not lead and account not in by_account:
            continue
        mine = [by_account[account]] if account in by_account else []
        others = sorted((v for a, v in by_account.items() if a != account), key=lambda v: v["labeler"])
        shown = mine + others
        claim = text.get(claim_id) or next((v["claim"] for v in shown if v["claim"]), "")
        pairs.append(
            {
                "claim_id": claim_id,
                "reference_id": reference_id,
                "claim": claim,
                "reference_title": titles.get(reference_id, reference_id),
                "agree": len(shown) > 1 and len({v["evidence"] for v in shown}) == 1,
                "verdicts": [{k: v for k, v in verdict.items() if k != "claim"} for verdict in shown],
                "notes": notes_of.get((claim_id, reference_id), []),
            }
        )
    pairs.sort(
        key=lambda p: (
            len(p["verdicts"]) < 2,
            p["agree"],
            order.get(p["claim_id"], len(order)),
            p["claim_id"],
            p["reference_id"],
        )
    )
    return {
        "paper_id": session["paper_id"],
        "title": session["title"],
        "labelers": sorted({v["labeler"] for p in pairs for v in p["verdicts"]}),
        "pairs": pairs,
    }
