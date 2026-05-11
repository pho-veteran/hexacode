import os

ALLOWED_ORIGIN = os.environ["ALLOWED_ORIGIN"]


def handler(event, context):
    return {
        "statusCode": 204,
        "headers": {
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type, x-correlation-id",
            "Access-Control-Max-Age": "300",
        },
        "body": "",
    }