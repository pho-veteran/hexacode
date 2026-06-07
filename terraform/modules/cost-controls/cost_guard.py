import os
import json
import boto3
from datetime import datetime

# Environment-driven configuration — no hardcoded values
ECS_CLUSTER_NAME          = os.environ.get("ECS_CLUSTER_NAME", "")
PROTECTION_TAG_KEY        = os.environ.get("PROTECTION_TAG_KEY", "Protected")
PROTECTION_TAG_VALUE      = os.environ.get("PROTECTION_TAG_VALUE", "true")
SNS_TOPIC_ARN             = os.environ.get("SNS_TOPIC_ARN", "")
DLQ_URL                   = os.environ.get("DLQ_URL", "")
ECS_REGION                = os.environ.get("ECS_REGION", "us-west-2")
ENVIRONMENT               = os.environ.get("ENVIRONMENT", "unknown")

sns = boto3.client("sns", region_name=ECS_REGION)
ecs = boto3.client("ecs", region_name=ECS_REGION)


def send_alert(message: str, severity: str = "INFO"):
    """Send SNS alert with structured payload."""
    if not SNS_TOPIC_ARN:
        print(f"⚠️ SNS_TOPIC_ARN not set — skipping alert: {message}")
        return
    try:
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"[{ENVIRONMENT}] Cost Guard {severity}: {message}",
            Message=json.dumps({
                "environment"  : ENVIRONMENT,
                "timestamp"    : datetime.utcnow().isoformat() + "Z",
                "severity"     : severity,
                "message"      : message,
                "cluster"      : ECS_CLUSTER_NAME,
                "protection_tag": f"{PROTECTION_TAG_KEY}={PROTECTION_TAG_VALUE}",
            }, indent=2),
        )
    except Exception as e:
        print(f"❌ Failed to send SNS alert: {e}")


def send_to_dlq(error_msg: str, context: dict):
    """Forward a failed processing record to the dead-letter queue."""
    if not DLQ_URL:
        print(f"⚠️ DLQ_URL not set — cannot preserve failed event: {error_msg}")
        return
    try:
        sqs = boto3.client("sqs", region_name=ECS_REGION)
        sqs.send_message(
            QueueUrl=DLQ_URL,
            MessageBody=json.dumps({
                "error"       : error_msg,
                "context"     : context,
                "timestamp"   : datetime.utcnow().isoformat() + "Z",
                "source"      : "cost_guard_lambda",
            }),
            message_attributes={
                "ErrorType": {
                    "DataType"    : "String",
                    "StringValue" : "CostGuardLambdaFailure",
                },
                "Environment": {
                    "DataType"    : "String",
                    "StringValue" : ENVIRONMENT,
                },
            }
        )
        print(f"📬 Sent to DLQ: {error_msg}")
    except Exception as e:
        print(f"❌ Failed to send to DLQ: {e}")


def is_protected(service_arn: str) -> bool:
    """Check if a service has the protection tag set to the protection value."""
    try:
        tags_resp = ecs.list_tags_for_resource(resourceArn=service_arn)
        for tag in tags_resp.get("tags", []):
            if tag["key"] == PROTECTION_TAG_KEY and tag["value"] == PROTECTION_TAG_VALUE:
                return True
        return False
    except Exception as e:
        print(f"⚠️ Could not read tags for {service_arn}: {e}")
        return False  # Fail closed — untagged services get protected (not stopped)


def stop_unprotected_services():
    """
    List all services in the ECS cluster.
    - Services with protection tag = True → skip (protected)
    - Services without protection tag → scale desiredCount to 0 (cost stopped)
    Returns structured result for Lambda output and DLQ tracking.
    """
    result = {
        "timestamp"   : datetime.utcnow().isoformat() + "Z",
        "cluster"     : ECS_CLUSTER_NAME,
        "protection_tag": f"{PROTECTION_TAG_KEY}={PROTECTION_TAG_VALUE}",
        "stopped"     : [],
        "protected"   : [],
        "skipped"     : [],  # already at 0
        "errors"      : [],
    }

    try:
        # Paginate in case cluster has many services
        paginator = ecs.get_paginator("list_services")
        pages = paginator.paginate(cluster=ECS_CLUSTER_NAME)

        for page in pages:
            for service_arn in page.get("serviceArns", []):
                service_name = service_arn.split("/")[-1]

                if is_protected(service_arn):
                    result["protected"].append(service_name)
                    print(f"🛡️ [{service_name}] has {PROTECTION_TAG_KEY}={PROTECTION_TAG_VALUE} — protected")
                    continue

                try:
                    desc = ecs.describe_services(
                        cluster=ECS_CLUSTER_NAME,
                        services=[service_name],
                    )
                    svc = desc["services"][0]
                    desired  = svc.get("desiredCount", 0)
                    running  = svc.get("runningCount", 0)
                    status   = svc.get("status", "UNKNOWN")

                    if desired == 0 or status == "INACTIVE":
                        result["skipped"].append({
                            "service" : service_name,
                            "reason"  : "already_stopped_or_inactive",
                            "desired" : desired,
                        })
                        print(f"ℹ️ [{service_name}] already stopped (desired={desired})")
                        continue

                    print(f"🎯 [{service_name}] unprotected — stopping (desired={desired}, running={running})")
                    ecs.update_service(
                        cluster=ECS_CLUSTER_NAME,
                        service=service_name,
                        desiredCount=0,
                    )
                    result["stopped"].append({
                        "service"      : service_name,
                        "previous_count": int(desired),
                        "new_count"    : 0,
                        "running_count": int(running),
                        "reason"       : "cost_guard_unprotected",
                    })
                    print(f"🛑 [{service_name}] stopped (was running {running} task(s))")

                except Exception as e:
                    err = f"❌ [{service_name}] — {str(e)}"
                    result["errors"].append(err)
                    print(err)

    except Exception as e:
        err = f"❌ Cluster listing failed: {str(e)}"
        result["errors"].append(err)
        print(err)
        send_alert(f"Cost guard failed to list cluster services: {e}", severity="ERROR")

    # Summary
    total_stopped   = len(result["stopped"])
    total_protected = len(result["protected"])
    total_skipped   = len(result["skipped"])
    total_errors    = len(result["errors"])

    print(f"\n📊 Cost Guard Summary — {ENVIRONMENT}")
    print(f"   🛑 Stopped  : {total_stopped}  (unprotected services scaled to 0)")
    print(f"   🛡️ Protected : {total_protected}  (tagged, unchanged)")
    print(f"   ℹ️ Skipped   : {total_skipped}   (already stopped)")
    print(f"   ❌ Errors   : {total_errors}")

    # Alert if anything was stopped
    if total_stopped > 0:
        send_alert(
            f"Cost guard stopped {total_stopped} unprotected service(s): "
            + ", ".join([s["service"] for s in result["stopped"]]),
            severity="WARNING"
        )

    if total_errors > 0:
        send_to_dlq(
            f"Cost guard had {total_errors} error(s): {'; '.join(result['errors'][:3])}",
            context={"result": result}
        )

    return result


# ---------------------------------------------------------------------------
# SNS event handler — triggered when Budgets alert fires
# ---------------------------------------------------------------------------

def handle_sns_event(event):
    for record in event.get("Records", []):
        try:
            sns_msg = json.loads(record["Sns"]["Message"])
            budget_name = sns_msg.get("BudgetName", "unknown")
            actual      = sns_msg.get("ActualAmount", "N/A")
            threshold   = sns_msg.get("Threshold", "N/A")
            limit       = sns_msg.get("BudgetLimit", "N/A")

            print(f"📊 Budget alert — {budget_name}: {actual} / {limit} (threshold={threshold})")
            send_alert(f"Budget alert for '{budget_name}': spent {actual} of {limit}", severity="WARNING")

            # Budget exceeded — invoke cost guard
            stop_unprotected_services()

        except json.JSONDecodeError:
            print(f"⚠️ Non-JSON SNS message: {record['Sns'].get('Message', '')[:200]}")
        except Exception as e:
            print(f"❌ Error processing SNS record: {e}")
            send_to_dlq(str(e), context={"event": event})

    return {"statusCode": 200, "body": "Processed SNS budget alert"}


# ---------------------------------------------------------------------------
# Direct invoke handler — used by EventBridge Scheduler
# ---------------------------------------------------------------------------

def handle_direct_invoke(event):
    return stop_unprotected_services()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def lambda_handler(event, context):
    print(f"📨 Cost Guard invoked — source: {event.get('source', 'direct')}")
    print(f"   Cluster: {ECS_CLUSTER_NAME}")
    print(f"   Protection tag: {PROTECTION_TAG_KEY}={PROTECTION_TAG_VALUE}")

    try:
        if "Records" in event and event["Records"]:
            first = event["Records"][0]
            if first.get("EventSource") == "aws:sns":
                return handle_sns_event(event)

        return handle_direct_invoke(event)

    except Exception as e:
        err = f"Lambda handler exception: {str(e)}"
        print(err)
        send_to_dlq(err, context={"event": event})
        return {"statusCode": 500, "body": err}