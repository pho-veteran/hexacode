FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

COPY services/worker/pyproject.toml ./pyproject.toml
COPY services/worker/app ./app
COPY backend_common ./backend_common

RUN pip install --no-cache-dir .

CMD ["python", "-m", "app.main"]
