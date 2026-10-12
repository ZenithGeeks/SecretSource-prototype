"""The Google Sheet the team labels into: the shared record (rows are appended, never edited).

Reads and writes go through the Sheets API with a service account, so the sheet has to be shared
with that account as an editor. Values are written RAW: a rationale that starts with "=" stays
text instead of becoming a formula that runs for whoever opens the sheet.
"""

import json
import threading
from pathlib import Path
from typing import Protocol

from app import config
from app.labeling.schema import TABS

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class NotConfigured(Exception):
    """The sheet id or the credentials are missing, so there is nowhere to save."""


class Store(Protocol):
    def read(self, tab: str) -> list[dict]: ...

    def append(self, tab: str, rows: list[dict]) -> None: ...


def service_account_email() -> str:
    """Who to share the sheet with. The key itself is never read, only the address."""
    try:
        return json.loads(Path(config.LABELING_CREDENTIALS).read_text()).get("client_email", "")
    except (OSError, ValueError):
        return ""


class GoogleSheet:
    def __init__(self, sheet_id: str, credentials_path: str):
        if not sheet_id or not credentials_path:
            raise NotConfigured("set LABELING_SHEET_ID and LABELING_GOOGLE_CREDENTIALS")
        self.sheet_id = sheet_id
        self.credentials_path = credentials_path
        self._lock = threading.Lock()
        self._ready = False

    def _api(self):
        # Imported here so the gateway starts, and the tests run, without Google's libraries.
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        credentials = service_account.Credentials.from_service_account_file(
            self.credentials_path, scopes=SCOPES
        )
        return build("sheets", "v4", credentials=credentials, cache_discovery=False).spreadsheets()

    def _ensure_tabs(self, api) -> None:
        """Make the three tabs, with their header row, the first time."""
        with self._lock:
            if self._ready:
                return
            meta = api.get(spreadsheetId=self.sheet_id, fields="sheets.properties.title").execute()
            have = {s["properties"]["title"] for s in meta.get("sheets", [])}
            missing = [tab for tab in TABS if tab not in have]
            if missing:
                api.batchUpdate(
                    spreadsheetId=self.sheet_id,
                    body={"requests": [{"addSheet": {"properties": {"title": tab}}} for tab in missing]},
                ).execute()
            for tab in missing:
                api.values().update(
                    spreadsheetId=self.sheet_id,
                    range=f"{tab}!A1",
                    valueInputOption="RAW",
                    body={"values": [TABS[tab]]},
                ).execute()
            self._ready = True

    def read(self, tab: str) -> list[dict]:
        api = self._api()
        self._ensure_tabs(api)
        values = api.values().get(spreadsheetId=self.sheet_id, range=tab).execute().get("values", [])
        if not values:
            return []
        header, *rows = values
        return [dict(zip(header, row + [""] * (len(header) - len(row)), strict=False)) for row in rows]

    def append(self, tab: str, rows: list[dict]) -> None:
        if not rows:
            return
        api = self._api()
        self._ensure_tabs(api)
        api.values().append(
            spreadsheetId=self.sheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": [[row.get(column, "") for column in TABS[tab]] for row in rows]},
        ).execute()


_store: Store | None = None


def get_store() -> Store:
    """The configured sheet, or NotConfigured. Tests replace this with an in-memory store."""
    global _store
    if _store is None:
        _store = GoogleSheet(config.LABELING_SHEET_ID, config.LABELING_CREDENTIALS)
    return _store
