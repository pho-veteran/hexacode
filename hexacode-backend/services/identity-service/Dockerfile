FROM python:3.12-slim

WORKDIR /app

COPY services/identity-service/pyproject.toml ./pyproject.toml
COPY services/identity-service/app ./app
COPY backend_common ./backend_common
COPY db ./db

RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
