FROM python:3.12-slim

WORKDIR /app

COPY services/api-gateway/pyproject.toml ./pyproject.toml
COPY services/api-gateway/app ./app
COPY contracts ./contracts

RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
