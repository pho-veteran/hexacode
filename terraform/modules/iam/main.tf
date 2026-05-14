# IAM Module
# Creates ECS execution role, four ECS task roles, and service-specific IAM policies

locals {
  environment = var.environment
}

# =============================================================================
# ECS Execution Role
# =============================================================================
resource "aws_iam_role" "ecs_execution" {
  name = "hexacode-${local.environment}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Secrets Manager access for ECS execution role (pulled by containers at startup)
resource "aws_iam_policy" "ecs_execution_secrets" {
  name = "hexacode-${local.environment}-ecs-execution-secrets"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = var.application_secret_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_execution_secrets.arn
}

# KMS Decrypt for ECS execution role (needed when Secrets Manager uses a CMK)
resource "aws_iam_policy" "ecs_execution_kms_decrypt" {
  count = var.kms_key_arn != "" ? 1 : 0

  name = "hexacode-${local.environment}-ecs-execution-kms-decrypt"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = var.kms_key_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_kms_decrypt" {
  count = var.kms_key_arn != "" ? 1 : 0

  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.ecs_execution_kms_decrypt[0].arn
}

# =============================================================================
# Identity Service Task Role
# No extra application permissions per approved design
# =============================================================================
resource "aws_iam_role" "identity_task" {
  name = "hexacode-${local.environment}-identity-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# =============================================================================
# Problem Service Task Role
# S3: ListBucket + GetBucketLocation on bucket; scoped GetObject/PutObject/DeleteObject
# =============================================================================
resource "aws_iam_role" "problem_task" {
  name = "hexacode-${local.environment}-problem-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "problem_task_s3" {
  name = "hexacode-${local.environment}-problem-task-s3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = var.problem_bucket_arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${var.problem_bucket_arn}/problem/*",
          "${var.problem_bucket_arn}/testset/*",
          "${var.problem_bucket_arn}/problem/*/checker/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "problem_task_s3" {
  role       = aws_iam_role.problem_task.name
  policy_arn = aws_iam_policy.problem_task_s3.arn
}

# =============================================================================
# Submission Service Task Role
# SQS: GetQueueUrl/GetQueueAttributes/SendMessage/CreateQueue on judge queue
# S3:  ListBucket/GetBucketLocation/GetObject on submission bucket
# =============================================================================
resource "aws_iam_role" "submission_task" {
  name = "hexacode-${local.environment}-submission-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "submission_task_sqs" {
  name = "hexacode-${local.environment}-submission-task-sqs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:SendMessage",
          "sqs:CreateQueue"
        ]
        Resource = var.judge_queue_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "submission_task_sqs" {
  role       = aws_iam_role.submission_task.name
  policy_arn = aws_iam_policy.submission_task_sqs.arn
}

resource "aws_iam_policy" "submission_task_s3" {
  name = "hexacode-${local.environment}-submission-task-s3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = var.submission_bucket_arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${var.submission_bucket_arn}/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "submission_task_s3" {
  role       = aws_iam_role.submission_task.name
  policy_arn = aws_iam_policy.submission_task_s3.arn
}

resource "aws_iam_policy" "submission_artifacts_efs" {
  name = "hexacode-${local.environment}-submission-artifacts-efs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite"
        ]
        Resource = var.efs_file_system_arn
        Condition = {
          StringEquals = {
            "elasticfilesystem:AccessPointArn" = var.efs_access_point_arn
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "submission_task_efs" {
  role       = aws_iam_role.submission_task.name
  policy_arn = aws_iam_policy.submission_artifacts_efs.arn
}

# =============================================================================
# Worker Service Task Role
# SQS: GetQueueUrl/GetQueueAttributes/ReceiveMessage/DeleteMessage/ChangeMessageVisibility/CreateQueue
# S3:  GetObject on problem/*, testset/*; PutObject on problem/*/checker/*/compiled/*
# =============================================================================
resource "aws_iam_role" "worker_task" {
  name = "hexacode-${local.environment}-worker-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_policy" "worker_task_sqs" {
  name = "hexacode-${local.environment}-worker-task-sqs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:CreateQueue"
        ]
        Resource = var.judge_queue_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "worker_task_sqs" {
  role       = aws_iam_role.worker_task.name
  policy_arn = aws_iam_policy.worker_task_sqs.arn
}

resource "aws_iam_policy" "worker_task_s3" {
  name = "hexacode-${local.environment}-worker-task-s3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [
          "${var.problem_bucket_arn}/problem/*",
          "${var.problem_bucket_arn}/testset/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "${var.problem_bucket_arn}/problem/*/checker/*/compiled/*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "worker_task_s3" {
  role       = aws_iam_role.worker_task.name
  policy_arn = aws_iam_policy.worker_task_s3.arn
}

resource "aws_iam_role_policy_attachment" "worker_task_efs" {
  role       = aws_iam_role.worker_task.name
  policy_arn = aws_iam_policy.submission_artifacts_efs.arn
}
