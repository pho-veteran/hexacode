locals {
  name_prefix = "hexacode-${var.environment}"
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/aws/network-firewall/${local.name_prefix}/flow"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "alert" {
  name              = "/aws/network-firewall/${local.name_prefix}/alert"
  retention_in_days = 30
}

resource "aws_networkfirewall_rule_group" "domain_denylist" {
  capacity = 100
  name     = "${local.name_prefix}-domain-denylist"
  type     = "STATEFUL"

  rule_group {
    rules_source {
      rules_source_list {
        generated_rules_type = "DENYLIST"
        target_types         = ["HTTP_HOST", "TLS_SNI"]
        targets              = var.blocked_domains
      }
    }
  }
}

resource "aws_networkfirewall_firewall_policy" "main" {
  name = "${local.name_prefix}-policy"

  firewall_policy {
    stateless_default_actions          = ["aws:forward_to_sfe"]
    stateless_fragment_default_actions = ["aws:forward_to_sfe"]

    stateful_rule_group_reference {
      resource_arn = aws_networkfirewall_rule_group.domain_denylist.arn
    }
  }
}

resource "aws_networkfirewall_firewall" "main" {
  name                = "${local.name_prefix}-firewall"
  firewall_policy_arn = aws_networkfirewall_firewall_policy.main.arn
  vpc_id              = var.vpc_id

  dynamic "subnet_mapping" {
    for_each = var.firewall_subnet_ids

    content {
      subnet_id = subnet_mapping.value
    }
  }
}

resource "aws_networkfirewall_logging_configuration" "main" {
  firewall_arn = aws_networkfirewall_firewall.main.arn

  logging_configuration {
    log_destination_config {
      log_destination = {
        logGroup = aws_cloudwatch_log_group.flow.name
      }
      log_destination_type = "CloudWatchLogs"
      log_type             = "FLOW"
    }

    log_destination_config {
      log_destination = {
        logGroup = aws_cloudwatch_log_group.alert.name
      }
      log_destination_type = "CloudWatchLogs"
      log_type             = "ALERT"
    }
  }
}
