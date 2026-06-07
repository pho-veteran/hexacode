# ECS Services Module
# Deploys the four ECS Fargate services: identity, problem, submission, and worker

locals {
  environment = var.environment

  log_group_prefix = "/ecs/hexacode-${local.environment}"

  task_cpu = {
    identity   = 256
    problem    = 512
    submission = 512
    worker     = 1024
  }

  task_memory = {
    identity   = 512
    problem    = 2048
    submission = 1024
    worker     = 2048
  }
}

# =============================================================================
# Identity Service
# =============================================================================

resource "aws_ecs_task_definition" "identity_service" {
  family                   = "hexacode-${local.environment}-identity"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.task_cpu.identity
  memory                   = local.task_memory.identity
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.identity_task_role_arn

  tags = {
    Project     = "hexacode"
    Environment = local.environment
    Service     = "identity"
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "identity-service"
      image     = "${var.ecr_repository_url}:identity-service-${var.image_tag}"
      cpu       = local.task_cpu.identity
      memory    = local.task_memory.identity
      essential = true
      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "COGNITO_USER_POOL_ID"
          value = var.cognito_user_pool_id
        },
        {
          name  = "COGNITO_APP_CLIENT_ID"
          value = var.cognito_app_client_id
        },
        {
          name  = "COGNITO_ISSUER"
          value = var.cognito_issuer
        },
        {
          name  = "COGNITO_JWKS_URL"
          value = var.cognito_jwks_url
        }
      ]
      secrets = var.application_secret_arn != "" ? [
        {
          name      = "DATABASE_URL"
          valueFrom = "${var.application_secret_arn}:DATABASE_URL::"
        }
      ] : []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "${local.log_group_prefix}/identity-service"
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "identity_service" {
  name            = "hexacode-${local.environment}-identity-service"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.identity_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [desired_count]
  }

  deployment_controller {
    type = "ECS"
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_api_services_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_identity_arn
    container_name   = "identity-service"
    container_port   = 8000
  }

  depends_on = [aws_ecs_task_definition.identity_service]

  tags = {
    Name        = "hexacode-${local.environment}-identity-service"
    Project     = "hexacode"
    Environment = local.environment
    Service     = "identity"
    Protected   = "true" # Prevents cost guard Lambda from scaling to zero
  }
}

# =============================================================================
# Problem Service
# =============================================================================

resource "aws_ecs_task_definition" "problem_service" {
  family                   = "hexacode-${local.environment}-problem"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.task_cpu.problem
  memory                   = local.task_memory.problem
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.problem_task_role_arn

  tags = {
    Project     = "hexacode"
    Environment = local.environment
    Service     = "problem"
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "problem-service"
      image     = "${var.ecr_repository_url}:problem-service-${var.image_tag}"
      cpu       = local.task_cpu.problem
      memory    = local.task_memory.problem
      essential = true
      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "LOG_LEVEL"
          value = "INFO"
        },
        {
          name  = "AWS_REGION"
          value = var.region
        },
        {
          name  = "STORAGE_DRIVER"
          value = "s3"
        },
        {
          name  = "S3_REGION"
          value = var.region
        },
        {
          name  = "S3_FORCE_PATH_STYLE"
          value = "false"
        },
        {
          name  = "S3_BUCKET_PROBLEMS"
          value = var.problem_bucket_name
        },
        {
          name  = "COGNITO_USER_POOL_ID"
          value = var.cognito_user_pool_id
        },
        {
          name  = "COGNITO_APP_CLIENT_ID"
          value = var.cognito_app_client_id
        },
        {
          name  = "COGNITO_ISSUER"
          value = var.cognito_issuer
        },
        {
          name  = "COGNITO_JWKS_URL"
          value = var.cognito_jwks_url
        }
      ]
      secrets = var.application_secret_arn != "" ? [
        {
          name      = "DATABASE_URL"
          valueFrom = "${var.application_secret_arn}:DATABASE_URL::"
        },
        {
          name      = "REDIS_URL"
          valueFrom = "${var.application_secret_arn}:REDIS_URL::"
        }
      ] : []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "${local.log_group_prefix}/problem-service"
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "problem_service" {
  name            = "hexacode-${local.environment}-problem-service"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.problem_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [desired_count]
  }

  deployment_controller {
    type = "ECS"
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_api_services_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_problem_arn
    container_name   = "problem-service"
    container_port   = 8000
  }

  depends_on = [aws_ecs_task_definition.problem_service]

  tags = {
    Name        = "hexacode-${local.environment}-problem-service"
    Project     = "hexacode"
    Environment = local.environment
    Service     = "problem"
    Protected   = "true"
  }
}

# =============================================================================
# Submission Service
# =============================================================================

resource "aws_ecs_task_definition" "submission_service" {
  family                   = "hexacode-${local.environment}-submission"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.task_cpu.submission
  memory                   = local.task_memory.submission
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.submission_task_role_arn

  tags = {
    Project     = "hexacode"
    Environment = local.environment
    Service     = "submission"
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "submission-artifacts"

    efs_volume_configuration {
      file_system_id     = var.efs_file_system_id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = var.efs_access_point_id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "submission-service"
      image     = "${var.ecr_repository_url}:submission-service-${var.image_tag}"
      cpu       = local.task_cpu.submission
      memory    = local.task_memory.submission
      essential = true
      mountPoints = [
        {
          sourceVolume  = "submission-artifacts"
          containerPath = var.artifact_storage_root
          readOnly      = false
        }
      ]
      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "LOG_LEVEL"
          value = "INFO"
        },
        {
          name  = "AWS_REGION"
          value = var.region
        },
        {
          name  = "STORAGE_DRIVER"
          value = "efs"
        },
        {
          name  = "ARTIFACT_STORAGE_ROOT"
          value = var.artifact_storage_root
        },
        {
          name  = "QUEUE_DRIVER"
          value = "sqs"
        },
        {
          name  = "S3_REGION"
          value = var.region
        },
        {
          name  = "S3_FORCE_PATH_STYLE"
          value = "false"
        },
        {
          name  = "SQS_JUDGE_QUEUE_URL"
          value = var.judge_queue_url
        },
        {
          name  = "PROBLEM_SERVICE_URL"
          value = var.internal_service_base_url
        },
        {
          name  = "S3_BUCKET_SUBMISSIONS"
          value = var.submission_bucket_name
        },
        {
          name  = "COGNITO_USER_POOL_ID"
          value = var.cognito_user_pool_id
        },
        {
          name  = "COGNITO_APP_CLIENT_ID"
          value = var.cognito_app_client_id
        },
        {
          name  = "COGNITO_ISSUER"
          value = var.cognito_issuer
        },
        {
          name  = "COGNITO_JWKS_URL"
          value = var.cognito_jwks_url
        }
      ]
      secrets = var.application_secret_arn != "" ? [
        {
          name      = "DATABASE_URL"
          valueFrom = "${var.application_secret_arn}:DATABASE_URL::"
        }
      ] : []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "${local.log_group_prefix}/submission-service"
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "submission_service" {
  name            = "hexacode-${local.environment}-submission-service"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.submission_service.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [desired_count]
  }

  deployment_controller {
    type = "ECS"
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_submission_service_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.tg_submission_arn
    container_name   = "submission-service"
    container_port   = 8000
  }

  depends_on = [aws_ecs_task_definition.submission_service]

  tags = {
    Name        = "hexacode-${local.environment}-submission-service"
    Project     = "hexacode"
    Environment = local.environment
    Service     = "submission"
    Protected   = "true"
  }
}

# =============================================================================
# Worker Service
# =============================================================================

resource "aws_ecs_task_definition" "worker" {
  family                   = "hexacode-${local.environment}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = local.task_cpu.worker
  memory                   = local.task_memory.worker
  execution_role_arn       = var.ecs_execution_role_arn
  task_role_arn            = var.worker_task_role_arn

  tags = {
    Project     = "hexacode"
    Environment = local.environment
    Service     = "worker"
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "submission-artifacts"

    efs_volume_configuration {
      file_system_id     = var.efs_file_system_id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = var.efs_access_point_id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${var.ecr_repository_url}:worker-${var.image_tag}"
      cpu       = local.task_cpu.worker
      memory    = local.task_memory.worker
      essential = true
      mountPoints = [
        {
          sourceVolume  = "submission-artifacts"
          containerPath = var.artifact_storage_root
          readOnly      = false
        }
      ]
      environment = [
        {
          name  = "LOG_LEVEL"
          value = "INFO"
        },
        {
          name  = "AWS_REGION"
          value = var.region
        },
        {
          name  = "STORAGE_DRIVER"
          value = "efs"
        },
        {
          name  = "ARTIFACT_STORAGE_ROOT"
          value = var.artifact_storage_root
        },
        {
          name  = "QUEUE_DRIVER"
          value = "sqs"
        },
        {
          name  = "S3_REGION"
          value = var.region
        },
        {
          name  = "S3_FORCE_PATH_STYLE"
          value = "false"
        },
        {
          name  = "SQS_JUDGE_QUEUE_URL"
          value = var.judge_queue_url
        },
        {
          name  = "PROBLEM_SERVICE_URL"
          value = var.internal_service_base_url
        },
        {
          name  = "SUBMISSION_SERVICE_URL"
          value = var.internal_service_base_url
        },
        {
          name  = "WORKER_CONCURRENCY"
          value = "1"
        },
        {
          name  = "S3_BUCKET_PROBLEMS"
          value = var.problem_bucket_name
        },
        {
          name  = "S3_BUCKET_SUBMISSIONS"
          value = var.submission_bucket_name
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "${local.log_group_prefix}/worker"
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "hexacode-${local.environment}-worker"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 5
  launch_type     = "FARGATE"

  lifecycle {
    ignore_changes = [desired_count]
  }

  deployment_controller {
    type = "ECS"
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [var.sg_worker_id]
    assign_public_ip = false
  }

  depends_on = [aws_ecs_task_definition.worker]

  tags = {
    Name        = "hexacode-${local.environment}-worker"
    Project     = "hexacode"
    Environment = local.environment
    Service     = "worker"
    Protected   = "true"
  }
}
