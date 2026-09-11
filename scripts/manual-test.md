# Manual end-to-end test

Round trip: SPFx web part → HTTP gateway → MCP server → SharePoint → response.

## Prerequisites

1. `npm install` and `npm run build`.
2. `.env` configured (SharePoint creds + `JWT_SIGNING_KEY` + `HTTP_GATEWAY_PORT`).

## Steps

### 1. Start the MCP server (stdio) — for desktop clients

```bash
node dist/server.js
```

### 2. Start the HTTP gateway (for the SPFx web part)

```bash
node dist/api/mcp-http-server.js
```

### 3. Mint a dev token and call a tool

```bash
# A token with subject "alice" (in production the SSO mints this).
TOKEN=$(node -e 'const {createHmac}=require("crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"}),p=b({sub:"alice",exp:Math.floor(Date.now()/1000)+3600});const s=createHmac("sha256",process.env.JWT_SIGNING_KEY||"changeme").update(h+"."+p).digest("base64url");process.stdout.write(h+"."+p+"."+s)')

curl -s -X POST http://localhost:3001/api/mcp/tool \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"toolName":"query_project_data","args":{"listName":"Projects"}}'
```

Expected: a JSON body `{ "result": [ ...mapped projects... ] }`, and an `AI_ACTION`
row for `query_project_data` in the `AI_AuditLog` list.

### 4. Verify the audit trail

```bash
curl -s -X POST http://localhost:3001/api/mcp/tool \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"toolName":"get_audit_logs","args":{"userId":"alice"}}'
```

Expected: the audit log includes the `query_project_data` call from step 3.

### 5. SPFx web part

1. Set the web part property `mcpGatewayUrl` to the gateway URL (e.g. `http://localhost:3001`).
2. Type a project-related question into the chat box.
3. Confirm the assistant response renders, and the call appears in the audit log.
