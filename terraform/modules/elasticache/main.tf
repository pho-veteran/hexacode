# ElastiCache Module - Hexacode Redis Cache
# Creates Redis 7 replication group in private data subnets

resource "aws_elasticache_subnet_group" "main" {
  name       = "hexacode-${var.environment}-cache-subnet-group"
  subnet_ids = var.private_data_subnet_ids

  tags = {
    Name        = "hexacode-${var.environment}-cache-subnet-group"
    Environment = var.environment
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "hexacode-${var.environment}-redis"
  description          = "Hexacode Redis cache cluster"

  engine             = "redis"
  engine_version     = "7.0"
  node_type          = "cache.t4g.small"
  num_cache_clusters = 2

  port = 6379

  automatic_failover_enabled = true
  multi_az_enabled           = true

  at_rest_encryption_enabled = false

  security_group_ids = [var.redis_security_group_id]

  subnet_group_name = aws_elasticache_subnet_group.main.name

  maintenance_window       = "mon:05:00-mon:06:00"
  snapshot_window          = "04:00-05:00"
  snapshot_retention_limit = 7

  tags = {
    Name        = "hexacode-${var.environment}-redis"
    Environment = var.environment
  }
}