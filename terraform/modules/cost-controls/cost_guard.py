import boto3
import json
from datetime import datetime


def lambda_handler(event, context):
    print(f"📨 Received event: {json.dumps(event, indent=2)}")

    if "Records" in event and event["Records"][0].get("EventSource") == "aws:sns":
        return handle_sns_event(event)

    return handle_direct_invoke(event)


def handle_sns_event(event):
    try:
        sns_message = event["Records"][0]["Sns"]["Message"]
        print(f"📊 Budget Alert: {sns_message}")

        try:
            budget_data = json.loads(sns_message)
            budget_name = budget_data.get("BudgetName", "Unknown")
            amount = budget_data.get("ActualAmount", "Unknown")
        except Exception:
            budget_name = "Daily Budget"
            amount = "Over $150"

        print(f"🚨 BUDGET ALERT: {budget_name} - {amount}")

        result = stop_unprotected_services()

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": f"Budget alert processed: {budget_name}",
                    "cost_optimization": result,
                }
            ),
        }
    except Exception as error:
        print(f"❌ Error processing SNS event: {str(error)}")
        return {"statusCode": 500, "error": str(error)}


def handle_direct_invoke(event):
    return stop_unprotected_services()


def stop_unprotected_services():
    try:
        ecs = boto3.client("ecs", region_name="us-west-2")
        services_response = ecs.list_services(cluster="hexacode-prod")
        service_arns = services_response.get("serviceArns", [])

        stopped_services = []
        protected_services = []
        errors = []

        for service_arn in service_arns:
            service_name = service_arn.split("/")[-1]

            try:
                print(f"🔍 Checking service: {service_name}")
                tags_response = ecs.list_tags_for_resource(resourceArn=service_arn)
                tags = tags_response.get("tags", [])

                is_protected = False
                for tag in tags:
                    if tag["key"].lower() == "keep" and tag["value"].lower() == "true":
                        is_protected = True
                        print(f"🛡️ Service {service_name} có tag Keep=true - ĐƯỢC BẢO VỆ")
                        break

                if is_protected:
                    protected_services.append(service_name)
                    continue

                print(f"🎯 Service {service_name} KHÔNG có tag Keep=true - SẼ BỊ TẮT")
                service_details = ecs.describe_services(
                    cluster="hexacode-prod",
                    services=[service_name],
                )
                current_count = service_details["services"][0]["desiredCount"]

                if current_count > 0:
                    ecs.update_service(
                        cluster="hexacode-prod",
                        service=service_name,
                        desiredCount=0,
                    )
                    stopped_services.append(
                        {
                            "service": service_name,
                            "previous_count": current_count,
                            "new_count": 0,
                            "reason": "no_keep_tag",
                        }
                    )
                    print(f"🛑 STOPPED service: {service_name} (was running {current_count} tasks)")
                else:
                    print(f"ℹ️ Service {service_name} already stopped")
                    stopped_services.append(
                        {
                            "service": service_name,
                            "previous_count": 0,
                            "new_count": 0,
                            "note": "already_stopped",
                        }
                    )
            except Exception as error:
                error_msg = f"❌ ERROR processing {service_name}: {str(error)}"
                errors.append(error_msg)
                print(error_msg)

        result = {
            "timestamp": datetime.now().isoformat(),
            "stopped_services": stopped_services,
            "protected_services": protected_services,
            "errors": errors,
            "summary": {
                "stopped_count": len(stopped_services),
                "protected_count": len(protected_services),
                "error_count": len(errors),
            },
        }

        print("📊 SUMMARY:")
        print(f"   🛑 Stopped: {len(stopped_services)} services (no Keep=true tag)")
        print(f"   🛡️ Protected: {len(protected_services)} services (has Keep=true tag)")
        print(f"   ❌ Errors: {len(errors)}")

        return {
            "statusCode": 200,
            "body": json.dumps(result, indent=2),
        }
    except Exception as error:
        error_msg = f"❌ Error in cost optimization: {str(error)}"
        print(error_msg)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": error_msg}),
        }
