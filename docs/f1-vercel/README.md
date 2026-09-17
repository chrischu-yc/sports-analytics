# F1 Race Trace Vercel Prototype

This is a separate frontend/API prototype for the Streamlit F1 app.

## Local run

From this directory:

```bash
python -m http.server 8000
```

The static page will open, but `/api/f1` requires the Vercel Python runtime. For a full local test, use the Vercel CLI or deploy a preview.

## Vercel deployment

1. Create a Vercel project from this repository.
2. Set the project root directory to `docs/f1-vercel`.
3. Deploy with the default settings.

Vercel detects `api/f1.py` as a Python function and installs `requirements.txt`. The function disables FastF1's disk cache and returns only JSON session summaries.

This is intentionally a first slice. The next step is to move the race trace and telemetry calculations into API responses, then render them with a browser chart library.
