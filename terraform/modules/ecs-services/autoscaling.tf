# Autoscaling for ECS Services

# =============================================================================
# Identity Service Scaling
# =============================================================================

resource "aws_appautoscaling_target" "identity_service" {
  service_namespace  = "ecs"
  max_capacity       = 4
  min_capacity       = 2
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.identity_service.name}"
  scalable_dimension = "ecs:service:DesiredCount"
}

resource "aws_appautoscaling_policy" "identity_service_cpu" {
  name               = "hexacode-${var.environment}-identity-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.identity_service.resource_id
  scalable_dimension = aws_appautoscaling_target.identity_service.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    disable_scale_in   = false
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# =============================================================================
# Problem Service Scaling
# =============================================================================

resource "aws_appautoscaling_target" "problem_service" {
  service_namespace  = "ecs"
  max_capacity       = 8
  min_capacity       = 2
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.problem_service.name}"
  scalable_dimension = "ecs:service:DesiredCount"
}

resource "aws_appautoscaling_policy" "problem_service_cpu" {
  name               = "hexacode-${var.environment}-problem-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.problem_service.resource_id
  scalable_dimension = aws_appautoscaling_target.problem_service.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    disable_scale_in   = false
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "problem_service_memory" {
  name               = "hexacode-${var.environment}-problem-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.problem_service.resource_id
  scalable_dimension = aws_appautoscaling_target.problem_service.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 75
    disable_scale_in   = false
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

# =============================================================================
# Submission Service Scaling
# =============================================================================

resource "aws_appautoscaling_target" "submission_service" {
  service_namespace  = "ecs"
  max_capacity       = 8
  min_capacity       = 2
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.submission_service.name}"
  scalable_dimension = "ecs:service:DesiredCount"
}

resource "aws_appautoscaling_policy" "submission_service_cpu" {
  name               = "hexacode-${var.environment}-submission-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.submission_service.resource_id
  scalable_dimension = aws_appautoscaling_target.submission_service.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    disable_scale_in   = false
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "submission_service_memory" {
  name               = "hexacode-${var.environment}-submission-memory-scaling"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.submission_service.resource_id
  scalable_dimension = aws_appautoscaling_target.submission_service.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 75
    disable_scale_in   = false
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}

# =============================================================================
# Worker Service Scaling (queue-depth based)
#
# Strategy: scale so approx 1 visible message per running task.
# At steady state each task picks up one message, so visible count ~= backlog.
# Step adjustments:
#   1-10 messages  -> +1 task  (covers up to 10 concurrent jobs)
#   11-20 messages -> +2 tasks
#   21-30 messages -> +3 tasks
#   31-40 messages -> +4 tasks
#   41-50 messages -> +5 tasks (reaches max_capacity 20 at 100 messages)
# Scale down when queue is idle (0 messages) by -1.
# =============================================================================

resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  max_capacity       = 20
  min_capacity       = 1
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
}

# Step scaling policy with both scale-up and scale-down steps
resource "aws_appautoscaling_policy" "worker_queue_scaling" {
  name               = "hexacode-${var.environment}-worker-queue-scaling"
  policy_type        = "StepScaling"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Average"

    # Scale down when queue is empty
    step_adjustment {
      scaling_adjustment          = -1
      metric_interval_lower_bound = ""
      metric_interval_upper_bound = 0
    }

    # 1 task per 10 messages (1 visible message ~= 1 active job per task)
    step_adjustment {
      scaling_adjustment          = 1
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 10
    }

    step_adjustment {
      scaling_adjustment          = 2
      metric_interval_lower_bound = 10
      metric_interval_upper_bound = 20
    }

    step_adjustment {
      scaling_adjustment          = 3
      metric_interval_lower_bound = 20
      metric_interval_upper_bound = 30
    }

    step_adjustment {
      scaling_adjustment          = 4
      metric_interval_lower_bound = 30
      metric_interval_upper_bound = 40
    }

    step_adjustment {
      scaling_adjustment          = 5
      metric_interval_lower_bound = 40
    }
  }
}

# Alarm: queue depth >= 1 triggers scale-up
resource "aws_cloudwatch_metric_alarm" "worker_queue_depth_scale_up" {
  alarm_name          = "hexacode-${var.environment}-worker-queue-scale-up"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Scale up worker when at least 1 message is visible in the queue"

  dimensions = {
    QueueName = reverse(split("/", var.judge_queue_url))[0]
  }

  alarm_actions = [aws_appautoscaling_policy.worker_queue_scaling.arn]
}

# Alarm: queue depth = 0 triggers scale-down
resource "aws_cloudwatch_metric_alarm" "worker_queue_depth_scale_down" {
  alarm_name          = "hexacode-${var.environment}-worker-queue-scale-down"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 120
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "Scale down worker when queue is empty"

  dimensions = {
    QueueName = reverse(split("/", var.judge_queue_url))[0]
  }

  alarm_actions = [aws_appautoscaling_policy.worker_queue_scaling.arn]
}
