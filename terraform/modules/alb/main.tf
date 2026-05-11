# ALB Module
# Creates the internal application load balancer with target groups and listener rules

resource "aws_lb" "internal" {
  name               = "hexacode-${var.environment}-internal-alb"
  internal           = true
  load_balancer_type = "application"
  subnets            = var.private_app_subnet_ids
  security_groups    = [var.sg_internal_alb_id]

  enable_deletion_protection = false

  tags = {
    Name = "hexacode-${var.environment}-internal-alb"
  }
}

# Target Groups
resource "aws_lb_target_group" "tg_identity" {
  name     = "hexacode-${var.environment}-identity-tg"
  port     = 8000
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/healthz"
    matcher             = "200"
  }

  tags = {
    Name = "hexacode-${var.environment}-identity-tg"
  }
}

resource "aws_lb_target_group" "tg_problem" {
  name     = "hexacode-${var.environment}-problem-tg"
  port     = 8000
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/healthz"
    matcher             = "200"
  }

  tags = {
    Name = "hexacode-${var.environment}-problem-tg"
  }
}

resource "aws_lb_target_group" "tg_submission" {
  name     = "hexacode-${var.environment}-submission-tg"
  port     = 8000
  protocol = "HTTP"
  vpc_id   = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/healthz"
    matcher             = "200"
  }

  tags = {
    Name = "hexacode-${var.environment}-submission-tg"
  }
}

# HTTP Listener with default 404 response
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      status_code  = 404
      content_type = "text/plain"
      message_body = "Not Found"
    }
  }
}

# Identity Service Routes (priority 10)
resource "aws_lb_listener_rule" "identity_routes" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tg_identity.arn
  }

  condition {
    path_pattern {
      values = ["/api/auth*", "/api/dashboard/users*"]
    }
  }
}

# Submission Service Routes (priority 20)
resource "aws_lb_listener_rule" "submission_routes" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tg_submission.arn
  }

  condition {
    path_pattern {
      values = [
        "/api/submissions*",
        "/api/runtimes*",
        "/api/dashboard/operations*",
        "/internal/judge-jobs*",
        "/internal/runtimes*"
      ]
    }
  }
}

# Problem Service Routes (priority 30)
resource "aws_lb_listener_rule" "problem_routes" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.tg_problem.arn
  }

  condition {
    path_pattern {
      values = [
        "/api/problems*",
        "/api/tags*",
        "/api/dashboard*",
        "/internal/problems*",
        "/internal/checkers*",
        "/internal/cache/public-problems/invalidate"
      ]
    }
  }
}