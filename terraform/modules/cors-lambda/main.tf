# CORS Lambda Module
# Creates a preflight OPTIONS Lambda function for API Gateway

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "${path.module}/index.py"
  output_path = "${path.module}/cors_lambda.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "hexacode-${var.environment}-cors-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_exec_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "cors_preflight" {
  filename         = data.archive_file.lambda_zip.output_path
  function_name    = "hexacode-${var.environment}-cors-preflight"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  runtime          = "python3.12"
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      ALLOWED_ORIGIN = var.frontend_domain
    }
  }

  tags = {
    Name = "hexacode-${var.environment}-cors-preflight"
  }
}