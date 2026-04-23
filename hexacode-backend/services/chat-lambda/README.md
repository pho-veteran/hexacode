# Chat Lambda For Problem Lookup

This Lambda powers a **problem lookup chatbot**.

Scope:

- supported: finding relevant problems from the problem statement knowledge base
- not supported: solving problems, explaining hidden tests, giving authoritative editorial answers, or reading S3 files directly on each request

Runtime path:

```text
frontend -> gateway -> Lambda -> Bedrock Agent -> Knowledge Base -> S3 problem statements
```

The Lambda calls **Bedrock Agent Runtime**.
The Agent uses a **Knowledge Base** built from problem statement markdown files in S3.

## 1. What To Deploy

Deploy this file to Lambda:

```text
handler.py
```

Lambda handler setting:

```text
handler.lambda_handler
```

The handler expects:

- API Gateway HTTP API v2 event input
- Lambda proxy response output

The local `api-gateway` in this repo already simulates that event shape.

## 2. Exact Product Goal

The chatbot should answer questions like:

- "Find me a graph problem about shortest path"
- "I want a prefix sum problem with arrays"
- "Show me a medium problem about binary search"
- "Find a problem similar to range minimum query"

The chatbot should **not** be positioned as:

- a full problem-solving tutor
- an editorial generator
- a direct S3 document browser

Your Bedrock Agent instructions should reflect that.

## 3. Source Data In S3

Use normal S3 for the raw markdown documents.

Recommended source prefix:

```text
s3://<problem-bucket>/kb/problem-statements/<problem-slug>/statement.md
```

Examples:

```text
kb/problem-statements/two-sum/statement.md
kb/problem-statements/range-min-query/statement.md
kb/problem-statements/graph-paths/statement.md
```

Do not point the Knowledge Base at the full problem bucket if it also contains:

- testcase archives
- checker files
- media uploads
- compiled artifacts

Keep the KB source prefix clean and statement-only.

## 4. What Should Be In Each Markdown File

Each `statement.md` should contain only searchable problem information.

Recommended structure:

```md
# Two Sum

Slug: two-sum
Difficulty: easy
Tags: arrays, hash-map

Summary:
Find two indices whose values sum to the target.

Statement:
...

Constraints:
...

Examples:
...
```

This helps retrieval because the Agent can match:

- title
- slug
- difficulty
- tags
- summary
- full statement text

## 5. Create The Bedrock Knowledge Base

In AWS Console:

1. Open **Amazon Bedrock**
2. Open **Knowledge bases**
3. Create knowledge base
4. Choose:
   - data source: **Amazon S3**
   - vector store: **Amazon S3 Vectors**
5. Set the S3 source to:

   ```text
   s3://<problem-bucket>/kb/problem-statements/
   ```

6. Run the ingestion / sync job

After creation, copy:

```text
Knowledge Base ID
```

You will use it as:

```text
BEDROCK_KNOWLEDGE_BASE_ID=<kb-id>
```

## 6. Create The Bedrock Agent

Create one Agent dedicated to **problem lookup**.

Recommended instruction:

```text
You are the Hexacode problem lookup assistant.
Your only job is to help users find relevant problems from the attached knowledge base.
Prefer returning problem titles, slugs, difficulty, and a short reason why each match is relevant.
Do not act like a full tutoring assistant.
Do not invent hidden tests, unpublished platform data, or editorial details not present in the knowledge base.
If you are unsure, say that the knowledge base did not provide enough support.
```

Attach the Knowledge Base from section 5.

Then:

1. Prepare the agent
2. Create an alias

After creation, copy:

```text
Agent ID
Agent Alias ID
```

You will use them as:

```text
BEDROCK_AGENT_ID=<agent-id>
BEDROCK_AGENT_ALIAS_ID=<agent-alias-id>
```

## 7. Lambda Settings

Recommended Lambda config:

- Runtime: `Python 3.12`
- Architecture: `x86_64`
- Memory: `512 MB`
- Timeout: `30 seconds`
- Handler: `handler.lambda_handler`

## 8. Lambda Environment Variables

Set these on the Lambda.

Required:

```text
AWS_REGION=ap-southeast-1
BEDROCK_AGENT_ID=<your-agent-id>
BEDROCK_AGENT_ALIAS_ID=<your-agent-alias-id>
```

Recommended:

```text
BEDROCK_AGENT_REGION=ap-southeast-1
BEDROCK_KNOWLEDGE_BASE_ID=<your-kb-id>
BEDROCK_AGENT_TIMEOUT_SECONDS=20
BEDROCK_AGENT_NUMBER_OF_RESULTS=8
BEDROCK_AGENT_OVERRIDE_SEARCH_TYPE=SEMANTIC
BEDROCK_AGENT_PREVIOUS_TURNS=0
BEDROCK_AGENT_ENABLE_TRACE=false
LOG_LEVEL=INFO
CHAT_MAX_MESSAGES=12
CHAT_MAX_MESSAGE_CHARS=4000
CHAT_MAX_ROUTE_CHARS=240
```

Good defaults for lookup behavior:

- `BEDROCK_AGENT_NUMBER_OF_RESULTS=8`
- `BEDROCK_AGENT_OVERRIDE_SEARCH_TYPE=SEMANTIC`
- `BEDROCK_AGENT_PREVIOUS_TURNS=0`

Reason:

- you want current-query retrieval, not long chat memory
- you want the agent to search statements, not improvise from previous turns

## 9. IAM Policy For The Lambda

The Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeAgent"
      ],
      "Resource": "*"
    }
  ]
}
```

If you want stricter scope later, lock this down to the specific Agent and alias ARNs.

## 10. Upload The Lambda Code

From repo root:

```powershell
Compress-Archive -Path .\hexacode-backend\services\chat-lambda\handler.py -DestinationPath .\artifacts\chat-lambda.zip -Force
```

Then in AWS Lambda:

1. Create function
2. Runtime: `Python 3.12`
3. Handler: `handler.lambda_handler`
4. Upload `artifacts/chat-lambda.zip`
5. Add the env vars from section 8
6. Attach the IAM policy from section 9

No extra package install is needed for this version because the AWS Python runtime already includes `boto3`.

## 11. API Gateway Route In Cloud

Create a route:

- Method: `POST`
- Path: `/api/chat/messages`
- Integration: this Lambda
- Integration type: Lambda proxy

Cloud path:

```text
frontend -> AWS API Gateway -> Lambda -> Bedrock Agent -> Knowledge Base
```

## 12. Local Hexacode Wiring

The local gateway invokes the Lambda directly by name.

Set these in:

[hexacode-backend/.env](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/.env)

```text
AWS_REGION=ap-southeast-1
CHAT_LAMBDA_FUNCTION_NAME=<your-lambda-name>
CHAT_LAMBDA_QUALIFIER=
CHAT_LAMBDA_TIMEOUT_SECONDS=20
```

The local machine or container running `api-gateway` also needs AWS credentials with:

```text
lambda:InvokeFunction
```

on that Lambda.

Local path:

```text
frontend -> local api-gateway -> Lambda -> Bedrock Agent -> Knowledge Base
```

## 13. Test Event

Use this test event in Lambda console:

```json
{
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/api/chat/messages",
  "rawQueryString": "",
  "headers": {
    "content-type": "application/json",
    "x-correlation-id": "test-correlation-id",
    "x-chat-authenticated": "false"
  },
  "requestContext": {
    "http": {
      "method": "POST",
      "path": "/api/chat/messages",
      "sourceIp": "127.0.0.1",
      "userAgent": "manual-test"
    },
    "requestId": "test-request-id"
  },
  "body": "{\"sessionId\":\"chat-test-001\",\"messages\":[{\"role\":\"user\",\"content\":\"Find me a graph problem about shortest path.\"}],\"pageContext\":{\"route\":\"/problems\",\"area\":\"public\",\"problemSlug\":null}}",
  "isBase64Encoded": false
}
```

Expected kind of answer:

- one or more likely matching problems
- title
- slug
- maybe difficulty / tags
- short reason why they match

## 14. Common Errors

`500 BEDROCK_AGENT_ID must be configured.`

- You did not set the Agent ID on the Lambda.

`500 BEDROCK_AGENT_ALIAS_ID must be configured.`

- You did not set the Agent Alias ID on the Lambda.

`502 Bedrock Agent request failed: AccessDeniedException.`

- The Lambda role does not have `bedrock:InvokeAgent`, or the Agent is not accessible.

`502 Bedrock Agent request failed: ResourceNotFoundException.`

- The Agent ID or Agent Alias ID is wrong.

`502 Bedrock Agent did not return any response text.`

- The Agent ran but returned no final text.
- Check the Agent alias, instructions, and Knowledge Base attachment.

`502 Lambda route 'problem-chat' is unavailable`

- Local `api-gateway` cannot invoke the Lambda.
- Check local AWS credentials.
- Check `CHAT_LAMBDA_FUNCTION_NAME`.
- Check `AWS_REGION`.

## 15. Important Limitation

This Lambda does **not** read S3 files directly per request.

It only works through:

- Bedrock Agent
- attached Knowledge Base
- S3 statements already ingested into that Knowledge Base

If you upload new `statement.md` files to S3, you must re-sync the Knowledge Base before the chatbot can find them.

## 16. Source Files

- Lambda code: [handler.py](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/chat-lambda/handler.py)
- Local gateway invoke path: [api-gateway main.py](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/services/api-gateway/app/main.py)
- Backend env template: [hexacode-backend/.env.example](/C:/Users/thanh/Desktop/workspace/xbrain-courses/hexacode/hexacode-backend/.env.example)
