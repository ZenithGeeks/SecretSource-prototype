FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY status_bot/ status_bot/

RUN useradd --system --no-create-home --uid 10001 statusbot
USER statusbot

CMD ["python", "-m", "status_bot"]
