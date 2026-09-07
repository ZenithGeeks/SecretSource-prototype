# SecretSource Backend

This is the HTTP gateway for the frontend. It starts an analysis of a paper, lets the
client watch the analysis run over Server-Sent Events, and serves the resulting claims,
verdicts, and the source PDFs (as the PDF itself, as rendered page images, and as text
locations). Run it with `python -m uvicorn app.main:app --port 8080`, or with
`docker compose up -d gateway`.

Analyses are held in memory while they run and written to SQLite as they progress, so a
restart keeps the history (anything still marked `running` is marked as interrupted).

## API Reference

### POST /analyses

Starts an analysis of a paper given by path, DOI, arXiv ID, or URL.

Request body (JSON):

| Field  | Type | Required | Meaning                                                        |
| ------ | ---- | -------- | -------------------------------------------------------------- |
| `paper` | `str` | yes   | The paper to analyze: a path, DOI, arXiv ID, or URL.           |
| `verify` | `bool` | no  | Whether to verify claims against their sources. Defaults to `true`. |

Response: `{"id": "<analysis id>"}` — a 12-character hex id for the new analysis.

### POST /analyses/upload

Starts an analysis from an uploaded PDF file; the file is saved into the papers directory
and analyzed the same way as `POST /analyses`.

Request:

| Param    | Type    | Required | Meaning                                          |
| -------- | ------- | -------- | ------------------------------------------------ |
| `file`   | file (multipart) | yes | The PDF to upload. |
| `verify` | `bool`  | no       | Whether to verify claims. Defaults to `true`.    |

Response: `{"id": "<analysis id>"}`.

### GET /analyses

Lists every analysis, newest first.

No parameters.

Response: a JSON array of analyses, each with the analysis fields (see
`GET /analyses/{analysis_id}`) but with the `stages` list omitted.

### GET /analyses/{analysis_id}

Returns one analysis with its results.

Path parameters:

| Param         | Type  | Required | Meaning           |
| ------------- | ----- | -------- | ----------------- |
| `analysis_id` | `str` | yes      | The analysis id.  |

Response: the full analysis object — `id`, `paper`, `status` (`running`, `done`, or
`error`), `stages` (the recorded pipeline events), `claims`, and, once set, `file` and
`message` (the error message when `status` is `error`).

Errors: `404` — `"no such analysis"` when the id is not known.

### DELETE /analyses/{analysis_id}

Deletes an analysis.

Path parameters:

| Param         | Type  | Required | Meaning           |
| ------------- | ----- | -------- | ----------------- |
| `analysis_id` | `str` | yes      | The analysis id.  |

Response: `{"deleted": "<analysis id>"}`.

Errors: `404` — `"no such analysis"` when the id is not stored.

### GET /analyses/{analysis_id}/events

Server-Sent Events stream of the analysis's progress. It emits one event per pipeline
stage (including failures), first replaying the stages already recorded and then
streaming each new stage as it happens.

Path parameters:

| Param         | Type  | Required | Meaning           |
| ------------- | ----- | -------- | ----------------- |
| `analysis_id` | `str` | yes      | The analysis id.  |

Response: `text/event-stream`. Each event is a `data:` line carrying a JSON object with
a `stage` field plus stage-specific fields. Stages seen in the pipeline: `extracting`
(`message`), `extracted` (`claims`, `extracted`, `windows`), `verifying` (`claim`,
`source`), `verified` (`claim`, `verdict`), `failed` (`claim`, `source`, `reason`,
`message`), `done`, and `error` (`message`). The stream ends once the analysis is no
longer running.

Errors: `404` — `"no such analysis"` when the id is not known.

### GET /papers/{name}

Returns the source PDF itself.

Path parameters:

| Param  | Type  | Required | Meaning                          |
| ------ | ----- | -------- | -------------------------------- |
| `name` | `str` | yes      | The paper's file name (a bare file name, not a path). |

Response: the PDF, `application/pdf`, with the file name set.

Errors: `400` — `"a paper name is a file name, not a path"` when `name` contains a path
or starts with `.`; `404` — `"no such paper: <name>"` when the file does not exist.

### GET /papers/{name}/pages/{page_number}.png

Renders one page of the paper to a PNG image (rendered once, then served from cache).

Path parameters:

| Param         | Type  | Required | Meaning                          |
| ------------- | ----- | -------- | -------------------------------- |
| `name`        | `str` | yes      | The paper's file name.           |
| `page_number` | `int` | yes      | The 1-based page number.         |

Query parameters:

| Param | Type  | Required | Meaning                                          |
| ----- | ----- | -------- | ------------------------------------------------ |
| `dpi` | `int` | no       | Render resolution. Defaults to `110`; values above `300` are clamped to `300`. |

Response: the page image, `image/png`, with `Cache-Control: max-age=31536000`.

Errors: `400`/`404` from the paper-name check (see `GET /papers/{name}`); `404` —
`"<name> has <n> pages"` when `page_number` is out of range.

### GET /papers/{name}/find

Finds where a piece of text sits in the paper, returning the page and the boxes that
contain it. The returned boxes are in PDF points with a top-left origin; the client
scales them by `dpi / 72` to line them up with the rendered page.

Path parameters:

| Param  | Type  | Required | Meaning                          |
| ------ | ----- | -------- | -------------------------------- |
| `name` | `str` | yes      | The paper's file name.           |

Query parameters:

| Param  | Type    | Required | Meaning                                    |
| ------ | ------- | -------- | ------------------------------------------ |
| `q`    | `str`   | yes      | The text to locate in the paper.           |
| `page` | `int`   | no       | Restrict the search to this page.          |

Response: a JSON object with `page` and `boxes` (the located boxes); when nothing is
found it is `{"page": null, "boxes": []}`.

Errors: `400`/`404` from the paper-name check (see `GET /papers/{name}`).

### POST /verify

Checks one claim against one source, without running a whole analysis.

Request body (JSON):

| Field    | Type  | Required | Meaning                          |
| -------- | ----- | -------- | -------------------------------- |
| `claim`  | `str` | yes      | The claim text to check.         |
| `source` | `str` | yes      | The source to check it against.  |

Response: the verdict object, with `status` (`ok` on success), `verdict`, and `message`
fields.

### GET /health

Reports that the gateway is up and how many analyses it is holding.

No parameters.

Response: `{"ok": true, "analyses": <count>}`.
