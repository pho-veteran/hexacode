# ✅ W3 Capstone Checklist

## 0. Prerequisite — W2 must still work

* [ ] S3 buckets:

  * Block Public Access ON
  * Default encryption enabled
  * Versioning ON
* [ ] Bedrock must reuse existing W2 S3 bucket (not new one)
* [ ] IAM baseline:

  * MFA on root
  * No root usage
  * No wildcard policies (`*`)
* [ ] VPC from W2 reused (NOT recreated)
* [ ] Include **1 W2 feedback item** and show how W3 fixes it

---

## 1. Database Layer (Core)

### Decision

* [ ] Choose **1 correct paradigm + engine**:

  * Relational / Key-value / Document / Graph
* [ ] Justify choice based on **your app data**

### Base requirements (ALL engines)

* [ ] DB in **private subnet**
* [ ] No public access
* [ ] Encryption at rest enabled
* [ ] HA plan:

  * Multi-AZ OR replica OR documented SPOF
* [ ] At least **1 write + 1 read** (CLI or app)

### Operations (pick based on paradigm)

**Relational**

* [ ] ≥2 tables with foreign key
* [ ] 1 JOIN query
* [ ] 1 indexed lookup
* [ ] Backup enabled (≥7 days or manual plan)

**Key-value (DynamoDB)**

* [ ] High-cardinality partition key
* [ ] Auto scaling OR on-demand
* [ ] 1 Query (PK)
* [ ] 1 GSI query
* [ ] No Scan for main access

**Document**

* [ ] 1 aggregation pipeline
* [ ] 1 indexed query

**Graph**

* [ ] 1 traversal query (N-hop)
* [ ] 1 indexed lookup

### Extra conditions

* [ ] If self-hosted:

  * Backup plan documented
  * HA plan documented
* [ ] If expensive engine:

  * Monthly cost estimate

---

## 2. Data Access Pattern Log (VERY IMPORTANT)

* [ ] Part A: 3 real queries from your app + frequency
* [ ] Part B: Map each query → engine + index/PK + reasoning
* [ ] Part C: “Wrong paradigm” explanation (why others fail)

---

## 3. Bedrock (AI Layer)

* [ ] Knowledge Base created
* [ ] Connected to W2 S3 bucket
* [ ] ≥3 documents ingested (sync complete)
* [ ] Identify:

  * Embedding model
  * Vector store
* [ ] 1 real API call:

  * Retrieve OR RetrieveAndGenerate
  * NOT using Playground

---

## 4. Lambda (Serverless Layer)

* [ ] At least 1 Lambda function
* [ ] IAM role:

  * No `Action: "*"`
  * No `Resource: "*"`
* [ ] 1 trigger:

  * S3 event OR API Gateway
* [ ] Output visible:

  * CloudWatch logs OR DB write OR Bedrock response

---

## 5. VPC & Networking

* [ ] Diagram includes:

  * Public tier
  * Private app tier
  * Private DB tier
* [ ] S3 Gateway Endpoint created
* [ ] Route table shows endpoint
* [ ] DB Security Group:

  * Source = **App SG (NOT CIDR)**
* [ ] Can explain:

  * When to use NACL vs Security Group

---

## 6. Evidence Pack (MOST IMPORTANT)

📄 File: `docs/W3_evidence.md`

### Required sections

* [ ] 1. Cover (team + DB choice + W2 link)
* [ ] 2. Data Access Pattern Log
* [ ] 3. Deployment evidence (ALL criteria)

  * Screenshot/CLI + explanation
* [ ] 4. Working queries (2 operations)
* [ ] 5. Lambda + Bedrock evidence
* [ ] 6. VPC evidence
* [ ] 7. Negative security test (denied access)
* [ ] 8. Bonus (optional)

### Quality rules

* [ ] Screenshot + explanation (WHY, not WHAT)
* [ ] Real outputs (not empty/demo)
* [ ] Everything traceable

---

## 7. Live Demo (Friday)

* [ ] DB: write + read + 2 operations
* [ ] Bedrock: retrieval result (API, not UI)
* [ ] Lambda: triggered + logs
* [ ] Security: unauthorized access fails

---

## 8. Submission

* [ ] Push Evidence Pack to repo
* [ ] Post **commit link** before presentation

---

## 9. Bonus (Optional)

* [ ] Choose 1 real ops scenario (failover, restore, migration…)
* [ ] Include:

  * Before / after screenshots
  * Measurement
  * Reflection

---

# ⚠️ Critical Notes (what affects your grade most)

* Evidence Pack = **40% weight**
* Missing Evidence Pack → max score ~2
* Screenshots without explanation → capped ~3
* Must prove **“it works”**, not just “it deployed”

