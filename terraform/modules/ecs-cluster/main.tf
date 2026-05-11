# ECS Cluster Module
# Creates the ECS Fargate cluster with Fargate capacity provider

resource "aws_ecs_cluster" "main" {
  name = "hexacode-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = "/ecs/hexacode-${var.environment}/execute-command"
      }
    }
  }
}

# Fargate capacity provider with auto-scaling group
resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# CloudWatch Log Groups for each service
resource "aws_cloudwatch_log_group" "identity_service" {
  name              = "/ecs/hexacode-${var.environment}/identity-service"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "problem_service" {
  name              = "/ecs/hexacode-${var.environment}/problem-service"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "submission_service" {
  name              = "/ecs/hexacode-${var.environment}/submission-service"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/hexacode-${var.environment}/worker"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "execute_command" {
  name              = "/ecs/hexacode-${var.environment}/execute-command"
  retention_in_days = 30
}
