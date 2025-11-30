# OpenAI Agent Integration Setup Guide

This guide will help you set up Google Sheets tools for your OpenAI agent using the MCP REST API wrapper.

## Overview

This CRM MCP server provides a **REST API wrapper** that makes Google Sheets and Calendly tools accessible to OpenAI agents via HTTP endpoints. The architecture is:

```
OpenAI Agent → REST API (Port 3000) → MCP Bridge → Google Sheets/Calendly
```

## Prerequisites

1. Node.js installed (v18 or higher)
2. Google Cloud account with Sheets API enabled
3. Google Sheets spreadsheet for your CRM data
4. (Optional) Calendly account with API access

## Quick Start

### 1. Set Up Google Sheets Credentials

Follow the detailed instructions in [`google_cred/README.md`](./google_cred/README.md):

1. Create a Google Cloud project
2. Enable Google Sheets API
3. Create a service account
4. Download the credentials JSON file
5. Place it in `google_cred/credentials.json`
6. Share your spreadsheet with the service account email

### 2. Configure Environment Variables

Edit the `.env` file (already created for you):

```bash
# Required for Google Sheets
GOOGLE_SHEETS_CREDENTIALS_PATH=./google_cred/credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_actual_spreadsheet_id

# Optional: Configure API key for security
REST_API_KEY=your-secret-api-key

# Server configuration
MCP_SERVER_TYPE=all
REST_API_PORT=3000
```

**To get your Spreadsheet ID**:
- Open your Google Sheet
- Look at the URL: `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`
- Copy the `YOUR_SPREADSHEET_ID` part

### 3. Install Dependencies and Build

```bash
npm install
npm run build
```

### 4. Start the REST API Server

```bash
npm run start:api
```

You should see output like:

```
🚀 CRM MCP REST API Server
========================================
Server running on: http://localhost:3000
Documentation: http://localhost:3000/api/docs
Health check: http://localhost:3000/health

Available MCP servers: sheets, calendly
```

### 5. Test the API

Initialize your Google Sheet:

```bash
curl -X POST http://localhost:3000/api/servers/sheets/tools/initialize_sheet
```

List available tools:

```bash
curl http://localhost:3000/api/tools
```

## Integrating with OpenAI Agent

### Method 1: Use as External API (Recommended)

Configure your OpenAI agent to call the REST API endpoints directly.

#### Available Endpoints for Google Sheets:

1. **Initialize Sheet** (run this first):
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/initialize_sheet
   ```

2. **Add Customer Record**:
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/add_customer_record
   Content-Type: application/json

   {
     "name": "John Doe",
     "email": "john@example.com",
     "phone": "555-1234",
     "issue": "Login problem",
     "status": "open",
     "priority": "high",
     "notes": "Cannot reset password"
   }
   ```

3. **Get Customer Record**:
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/get_customer_record
   Content-Type: application/json

   {
     "id": "2"
   }
   ```

4. **Update Customer Record**:
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/update_customer_record
   Content-Type: application/json

   {
     "id": "2",
     "status": "resolved",
     "notes": "Issue fixed - password reset successful"
   }
   ```

5. **Search Customer Records**:
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/search_customer_records
   Content-Type: application/json

   {
     "status": "open",
     "priority": "high"
   }
   ```

6. **List All Customers**:
   ```bash
   POST http://localhost:3000/api/servers/sheets/tools/list_all_customers
   ```

7. **Check Customer History** (by phone):
   ```bash
   GET http://localhost:3000/api/google-sheets/check-customer?phone_number=555-1234
   ```

### Method 2: Create OpenAPI Schema for OpenAI

Create an OpenAPI specification that your OpenAI agent can import:

```yaml
openapi: 3.0.0
info:
  title: CRM MCP API
  version: 1.0.0
  description: Google Sheets CRM integration via MCP
servers:
  - url: http://localhost:3000
    description: Local development server
  - url: YOUR_PRODUCTION_URL
    description: Production server

paths:
  /api/servers/sheets/tools/add_customer_record:
    post:
      operationId: addCustomerRecord
      summary: Add a new customer service record
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, email, issue, status, priority]
              properties:
                name:
                  type: string
                  description: Customer name
                email:
                  type: string
                  format: email
                  description: Customer email address
                phone:
                  type: string
                  description: Customer phone number
                issue:
                  type: string
                  description: Description of the customer issue
                status:
                  type: string
                  enum: [open, in-progress, resolved, closed]
                  description: Current status of the issue
                priority:
                  type: string
                  enum: [low, medium, high, urgent]
                  description: Priority level of the issue
                notes:
                  type: string
                  description: Additional notes about the issue
      responses:
        '200':
          description: Customer record added successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  content:
                    type: array
                    items:
                      type: object

  /api/servers/sheets/tools/search_customer_records:
    post:
      operationId: searchCustomerRecords
      summary: Search customer records by criteria
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                email:
                  type: string
                name:
                  type: string
                status:
                  type: string
                  enum: [open, in-progress, resolved, closed]
                priority:
                  type: string
                  enum: [low, medium, high, urgent]
      responses:
        '200':
          description: Search results
          content:
            application/json:
              schema:
                type: object

  /api/google-sheets/check-customer:
    get:
      operationId: checkCustomerHistory
      summary: Retrieve customer service history by phone number
      parameters:
        - name: phone_number
          in: query
          required: true
          schema:
            type: string
          description: Customer phone number to search for
      responses:
        '200':
          description: Customer history retrieved
          content:
            application/json:
              schema:
                type: object

components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key

security:
  - ApiKeyAuth: []
```

Save this as `openai-api-spec.yaml` and import it into your OpenAI agent's actions.

### Method 3: Deploy to Cloud for OpenAI Access

If you want OpenAI to access your API from the cloud:

#### Option A: Use ngrok for testing

```bash
# Install ngrok: https://ngrok.com/
ngrok http 3000
```

This will give you a public URL like `https://abc123.ngrok.io` that you can use in OpenAI.

#### Option B: Deploy to a cloud service

Deploy the REST API to:
- **Vercel/Netlify**: For serverless deployment
- **Heroku**: For traditional hosting
- **AWS Lambda/API Gateway**: For serverless AWS
- **DigitalOcean/Linode**: For VPS hosting

See [`REST_API_GUIDE.md`](./REST_API_GUIDE.md) for deployment instructions.

## OpenAI Agent Configuration Example

### 1. In OpenAI Platform

1. Go to your agent settings
2. Add a new "Action"
3. Choose "Import from URL" or paste the OpenAPI spec above
4. Set the base URL to your server (localhost or deployed URL)
5. Configure authentication (if using API key)

### 2. Test with OpenAI Agent

In your OpenAI agent chat:

```
User: "Add a new customer named Alice Smith with email alice@example.com who
has a billing issue with high priority"

Agent will call:
POST /api/servers/sheets/tools/add_customer_record
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "issue": "billing issue",
  "status": "open",
  "priority": "high"
}
```

## Security Best Practices

### 1. Enable API Key Authentication

In `.env`:
```bash
REST_API_KEY=your-strong-random-api-key-here
```

Then include the key in all requests:
```bash
curl -H "x-api-key: your-strong-random-api-key-here" \
  http://localhost:3000/api/tools
```

### 2. Use HTTPS in Production

- Never use `http://` in production
- Always deploy with TLS/SSL certificates
- Use services like Let's Encrypt for free certificates

### 3. Restrict CORS Origins

Edit `src/rest-api.ts` to limit allowed origins:

```typescript
app.use(cors({
  origin: ['https://your-openai-domain.com']
}));
```

### 4. Rate Limiting

The API has rate limiting enabled by default (100 requests per 15 minutes per IP).

## Available Tools

### Google Sheets Tools

| Tool | Description | OpenAI Use Case |
|------|-------------|-----------------|
| `initialize_sheet` | Set up sheet headers | Run once during setup |
| `add_customer_record` | Add new customer | When user reports an issue |
| `get_customer_record` | Get customer by ID | Lookup specific record |
| `update_customer_record` | Update existing record | Update status/notes |
| `search_customer_records` | Search by criteria | Find customers by filter |
| `list_all_customers` | Get all records | Generate reports |
| `check_customer_history` | Search by phone | Check returning customers |

### Calendly Tools (if configured)

| Tool | Description | OpenAI Use Case |
|------|-------------|-----------------|
| `list_event_types` | List appointment types | Show available services |
| `get_scheduling_link` | Get booking URL | Provide booking link |
| `list_scheduled_events` | List appointments | Check schedule |

## Troubleshooting

### Error: "Server 'sheets' not found or not configured"

**Solution**:
1. Check that `.env` has the correct Google Sheets credentials path
2. Verify the credentials file exists: `ls google_cred/credentials.json`
3. Restart the API server: `npm run start:api`

### Error: "Unable to read credentials"

**Solution**:
1. Make sure you've downloaded the service account JSON from Google Cloud
2. Place it at `google_cred/credentials.json`
3. Check file permissions: `chmod 644 google_cred/credentials.json`

### Error: "Permission denied" when accessing sheet

**Solution**:
1. Open your credentials file: `cat google_cred/credentials.json`
2. Find the `client_email` field
3. Share your Google Sheet with that email address (Editor permissions)

### API returns "401 Unauthorized"

**Solution**:
1. If you set `REST_API_KEY` in `.env`, include it in requests
2. Add header: `-H "x-api-key: your-api-key"`
3. Or disable authentication by removing `REST_API_KEY` from `.env`

### OpenAI can't reach the API

**Solution**:
1. If using localhost, OpenAI can't access it - use ngrok or deploy to cloud
2. Check firewall settings
3. Verify the URL is publicly accessible

## Testing Checklist

- [ ] Google credentials file is in `google_cred/credentials.json`
- [ ] `.env` file has correct `GOOGLE_SHEETS_SPREADSHEET_ID`
- [ ] Spreadsheet is shared with service account email
- [ ] `npm run build` completes successfully
- [ ] `npm run start:api` starts without errors
- [ ] `curl http://localhost:3000/health` returns healthy status
- [ ] Initialize sheet endpoint works
- [ ] Can add a test customer record
- [ ] OpenAI agent can reach the API (if deployed)

## Next Steps

1. ✅ Set up Google Sheets credentials (see `google_cred/README.md`)
2. ✅ Configure `.env` file
3. ✅ Build and start the API server
4. ✅ Test endpoints locally
5. ⬜ Deploy to cloud (if needed for OpenAI)
6. ⬜ Configure OpenAI agent actions
7. ⬜ Test end-to-end with OpenAI agent

## Additional Resources

- [Full REST API Documentation](./REST_API_GUIDE.md)
- [OpenAI Integration Guide](./OPENAI_INTEGRATION.md)
- [Google Sheets Credentials Setup](./google_cred/README.md)
- [MCP Protocol Documentation](https://modelcontextprotocol.io/)

## Support

For issues:
1. Check the troubleshooting section above
2. Review server logs from `npm run start:api`
3. Verify credentials and permissions
4. Open an issue on GitHub with details

## Example OpenAI Agent Conversation

```
User: "I have a customer calling about a login issue. Her name is Sarah Johnson,
email sarah@example.com, phone 555-8765. This is urgent."

OpenAI Agent:
✓ Calls add_customer_record API
✓ Creates record with status: "open", priority: "urgent"
✓ Returns: "I've created a customer support ticket for Sarah Johnson.
  Record ID: 5. This urgent issue has been logged and is now open for resolution."

User: "Check if we have any history for phone 555-8765"

OpenAI Agent:
✓ Calls check_customer_history API
✓ Returns previous tickets for that phone number
✓ Shows: "Sarah Johnson has contacted us twice before: once for a billing
  question (resolved) and once for a feature request (closed)."
```

---

**Ready to get started?** Follow the Google Sheets setup guide in `google_cred/README.md`!
