resource "aws_ecr_repository" "hexacode" {
  name                 = var.repository_name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "hexacode-${var.environment}-ecr"
  }
}

resource "aws_ecr_lifecycle_policy" "hexacode" {
  repository = aws_ecr_repository.hexacode.name

  policy = jsonencode({
    rules = concat(
      [
        for index, prefix in ["identity-service-", "problem-service-", "submission-service-", "worker-"] : {
          rulePriority = index + 1
          description  = "Keep the most recent 30 ${prefix} images"
          selection = {
            tagStatus     = "tagged"
            tagPrefixList = [prefix]
            countType     = "imageCountMoreThan"
            countNumber   = 30
          }
          action = {
            type = "expire"
          }
        }
      ],
      [
        {
          rulePriority = 5
          description  = "Expire untagged images after 7 days"
          selection = {
            tagStatus   = "untagged"
            countType   = "sinceImagePushed"
            countUnit   = "days"
            countNumber = 7
          }
          action = {
            type = "expire"
          }
        }
      ]
    )
  })
}
