import json
import os

import boto3
from botocore.exceptions import ClientError


bedrock_agent = boto3.client("bedrock-agent")


def handler(event, context):
    knowledge_base_id = os.environ["KNOWLEDGE_BASE_ID"]
    data_source_id = os.environ["DATA_SOURCE_ID"]

    records = event.get("Records", [])
    print(json.dumps({"message": "kb sync trigger received", "record_count": len(records)}))

    try:
        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            description="Hexacode automatic S3 problem asset sync",
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        message = error.response.get("Error", {}).get("Message", "")
        if code in {"ConflictException", "ThrottlingException"} or "ingestion job" in message.lower():
            print(json.dumps({"message": "kb sync skipped", "code": code, "detail": message}))
            return {"statusCode": 202, "body": "sync already running or throttled"}
        raise

    ingestion_job = response.get("ingestionJob", {})
    print(json.dumps({"message": "kb sync started", "ingestion_job_id": ingestion_job.get("ingestionJobId")}))
    return {"statusCode": 202, "body": "sync started"}
