def main(params: dict) -> dict:
    date_text = str(params.get("date_text") or "").strip()

    try:
        week = int(params.get("week"))
    except Exception:
        week = None

    if week is not None and 1 <= week <= 20:
        return {"safe_date_text": ""}
    return {"safe_date_text": date_text}
