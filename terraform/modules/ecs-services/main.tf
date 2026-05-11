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
    submission = 1536
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "identity-service"
      image     = "${var.ecr_repository_url}:identity-${var.image_tag}"
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
          name  = "DATABASE_URL"
          value = "postgresql://placeholder"
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
  task_definition = aws_ecs_task_definition.identity_service.family
  desired_count   = 2
  launch_type     = "FARGATE"

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
    Name = "hexacode-${local.environment}-identity-service"
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "problem-service"
      image     = "${var.ecr_repository_url}:problem-${var.image_tag}"
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
          name  = "DATABASE_URL"
          value = "postgresql://placeholder"
        },
        {
          name  = "REDIS_URL"
          value = "redis://placeholder:6379"
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
  task_definition = aws_ecs_task_definition.problem_service.family
  desired_count   = 2
  launch_type     = "FARGATE"

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
    Name = "hexacode-${local.environment}-problem-service"
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "submission-service"
      image     = "${var.ecr_repository_url}:submission-${var.image_tag}"
      cpu       = local.task_cpu.submission
      memory    = local.task_memory.submission
      essential = true
      portMappings = [
        {
          containerPort = 8000
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "DATABASE_URL"
          value = "postgresql://placeholder"
        },
        {
          name  = "SQS_QUEUE_URL"
          value = var.judge_queue_url
        },
        {
          name  = "INTERNAL_ALB_URL"
          value = "http://${var.internal_alb_dns_name}"
        },
        {
          name  = "S3_BUCKET_SUBMISSIONS"
          value = var.submission_bucket_name
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
  task_definition = aws_ecs_task_definition.submission_service.family
  desired_count   = 2
  launch_type     = "FARGATE"

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
    target_group_arn = var.tg_submission_arn
    container_name   = "submission-service"
    container_port   = 8000
  }

  depends_on = [aws_ecs_task_definition.submission_service]

  tags = {
    Name = "hexacode-${local.environment}-submission-service"
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${var.ecr_repository_url}:worker-${var.image_tag}"
      cpu       = local.task_cpu.worker
      memory    = local.task_memory.worker
      essential = true
      environment = [
        {
          name  = "SQS_QUEUE_URL"
          value = var.judge_queue_url
        },
        {
          name  = "INTERNAL_ALB_URL"
          value = "http://${var.internal_alb_dns_name}"
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
  task_definition = aws_ecs_task_definition.worker.family
  desired_count   = 5
  launch_type     = "FARGATE"

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
    Name = "hexacode-${local.environment}-worker"
  }
}
