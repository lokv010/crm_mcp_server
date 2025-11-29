# REST API Wrapper for MCP Servers

This document describes the REST API wrapper that translates HTTP requests to MCP (Model Context Protocol) calls, enabling HTTP/REST access to the Google Sheets CRM and Calendly MCP servers.

## Overview

The REST API wrapper provides a standard HTTP interface to interact with MCP servers, making it easy to integrate with web applications, mobile apps, and other services that communicate over HTTP.

### Architecture

```
HTTP Client → REST API Server → MCP Bridge → MCP Servers (Sheets/Calendly)
```

1. **REST API Server** (`src/rest-api.ts`): Express-based HTTP server with endpoints
2. **MCP Bridge** (`src/mcp-bridge.ts`): Adapter that translates HTTP requests to MCP protocol calls
3. **MCP Servers**: Google Sheets CRM and Calendly servers

## Quick Start

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Google Sheets Configuration
GOOGLE_SHEETS_CREDENTIALS_PATH=./path/to/credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id

# Calendly Configuration
CALENDLY_API_TOKEN=your_calendly_token
CALENDLY_ORGANIZATION_URI=https://api.calendly.com/organizations/your_org_id

# REST API Configuration
REST_API_PORT=3000
REST_API_KEY=your-secret-api-key-here
```

### 2. Build and Run

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the REST API server
npm run start:api
```

The server will start on `http://localhost:3000` (or the port specified in `REST_API_PORT`).

## Authentication

API key authentication is optional but recommended for production use.

### Enable Authentication

Set `REST_API_KEY` in your `.env` file:

```env
REST_API_KEY=my-secret-key-123
```

### Using API Key

Include the API key in one of two ways:

1. **Header** (recommended):
   ```bash
   curl -H "x-api-key: my-secret-key-123" http://localhost:3000/api/servers
   ```

2. **Query Parameter**:
   ```bash
   curl http://localhost:3000/api/servers?api_key=my-secret-key-123
   ```

### Disable Authentication

Leave `REST_API_KEY` empty or remove it from `.env`:

```env
# REST_API_KEY=  # Disabled
```

## API Endpoints

### Base URL

```
http://localhost:3000
```

### Health Check

**GET** `/health`

Check if the API server is running and which MCP servers are available.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-29T12:00:00.000Z",
  "servers": ["sheets", "calendly"]
}
```

**Example:**
```bash
curl http://localhost:3000/health
```

---

### List Servers

**GET** `/api/servers`

Get all available MCP servers with their details.

**Response:**
```json
{
  "success": true,
  "servers": [
    {
      "name": "sheets",
      "displayName": "Google Sheets CRM",
      "description": "Customer relationship management with Google Sheets integration",
      "toolCount": 6
    },
    {
      "name": "calendly",
      "displayName": "Calendly Appointments",
      "description": "Schedule and manage appointments through Calendly",
      "toolCount": 6
    }
  ]
}
```

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/servers
```

---

### List Server Tools

**GET** `/api/servers/:server/tools`

Get all available tools for a specific server.

**Parameters:**
- `server` (path): Server name (`sheets` or `calendly`)

**Response:**
```json
{
  "success": true,
  "server": {
    "name": "sheets",
    "displayName": "Google Sheets CRM",
    "description": "Customer relationship management with Google Sheets integration"
  },
  "tools": [
    {
      "name": "add_customer_record",
      "description": "Add a new customer service record to the Google Sheet",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Customer name" },
          "email": { "type": "string", "description": "Customer email address" },
          ...
        }
      }
    },
    ...
  ]
}
```

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/servers/sheets/tools
```

---

### List All Tools

**GET** `/api/tools`

Get all tools from all available servers.

**Response:**
```json
{
  "success": true,
  "tools": {
    "sheets": [...],
    "calendly": [...]
  }
}
```

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/tools
```

---

### Execute Tool

**POST** `/api/servers/:server/tools/:tool`

Execute a specific tool on a server.

**Parameters:**
- `server` (path): Server name
- `tool` (path): Tool name

**Request Body:** Tool-specific arguments as JSON

**Response:**
```json
{
  "success": true,
  "content": [
    {
      "type": "text",
      "text": "Customer record added successfully with ID: 5"
    }
  ]
}
```

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "issue": "Login problem",
    "status": "open",
    "priority": "high"
  }' \
  http://localhost:3000/api/servers/sheets/tools/add_customer_record
```

---

### Generic Call Endpoint

**POST** `/api/call`

Generic endpoint to call any tool on any server.

**Request Body:**
```json
{
  "server": "sheets",
  "tool": "add_customer_record",
  "arguments": {
    "name": "John Doe",
    "email": "john@example.com",
    "issue": "Login problem",
    "status": "open",
    "priority": "high"
  }
}
```

**Response:**
```json
{
  "success": true,
  "content": [
    {
      "type": "text",
      "text": "Customer record added successfully with ID: 5"
    }
  ]
}
```

**Example:**
```bash
curl -X POST \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "server": "sheets",
    "tool": "list_all_customers",
    "arguments": {}
  }' \
  http://localhost:3000/api/call
```

---

### API Documentation

**GET** `/api/docs`

Get comprehensive API documentation in JSON format, including all available servers, tools, and examples.

**Example:**
```bash
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/api/docs
```

## Google Sheets CRM Tools

### initialize_sheet
Initialize the Google Sheet with proper headers.

**Arguments:** None

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  http://localhost:3000/api/servers/sheets/tools/initialize_sheet
```

---

### add_customer_record
Add a new customer service record.

**Arguments:**
- `name` (string, required): Customer name
- `email` (string, required): Customer email
- `issue` (string, required): Issue description
- `status` (string, required): `open`, `in-progress`, `resolved`, or `closed`
- `priority` (string, required): `low`, `medium`, `high`, or `urgent`
- `phone` (string, optional): Phone number
- `notes` (string, optional): Additional notes

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "issue": "Cannot access account",
    "status": "open",
    "priority": "urgent",
    "notes": "Customer called multiple times"
  }' \
  http://localhost:3000/api/servers/sheets/tools/add_customer_record
```

---

### get_customer_record
Retrieve a specific customer record by ID.

**Arguments:**
- `id` (string, required): Record ID (row number)

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "5"}' \
  http://localhost:3000/api/servers/sheets/tools/get_customer_record
```

---

### update_customer_record
Update an existing customer record.

**Arguments:**
- `id` (string, required): Record ID to update
- Other fields (optional): Any field from `add_customer_record`

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "5",
    "status": "resolved",
    "notes": "Issue fixed by resetting password"
  }' \
  http://localhost:3000/api/servers/sheets/tools/update_customer_record
```

---

### search_customer_records
Search records by email, name, status, or priority.

**Arguments:**
- `email` (string, optional): Search by email
- `name` (string, optional): Search by name
- `status` (string, optional): Filter by status
- `priority` (string, optional): Filter by priority

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "open", "priority": "urgent"}' \
  http://localhost:3000/api/servers/sheets/tools/search_customer_records
```

---

### list_all_customers
List all customer records.

**Arguments:** None

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  http://localhost:3000/api/servers/sheets/tools/list_all_customers
```

## Calendly Tools

### list_event_types
List all available Calendly event types.

**Arguments:** None

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  http://localhost:3000/api/servers/calendly/tools/list_event_types
```

---

### get_event_type
Get details about a specific event type.

**Arguments:**
- `eventTypeUri` (string, required): Event type URI

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventTypeUri": "https://api.calendly.com/event_types/XXXXX"}' \
  http://localhost:3000/api/servers/calendly/tools/get_event_type
```

---

### get_scheduling_link
Get the scheduling link for an event type.

**Arguments:**
- `eventTypeUri` (string, required): Event type URI

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventTypeUri": "https://api.calendly.com/event_types/XXXXX"}' \
  http://localhost:3000/api/servers/calendly/tools/get_scheduling_link
```

---

### list_scheduled_events
List scheduled events with optional filters.

**Arguments:**
- `status` (string, optional): `active` or `canceled`
- `minStartTime` (string, optional): Minimum start time (ISO 8601)
- `maxStartTime` (string, optional): Maximum start time (ISO 8601)

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "active",
    "minStartTime": "2025-11-29T00:00:00Z"
  }' \
  http://localhost:3000/api/servers/calendly/tools/list_scheduled_events
```

---

### get_event_invitee
Get details about event invitees.

**Arguments:**
- `inviteeUri` (string, required): Invitee URI (event URI)

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"inviteeUri": "https://api.calendly.com/scheduled_events/XXXXX"}' \
  http://localhost:3000/api/servers/calendly/tools/get_event_invitee
```

---

### cancel_event
Cancel a scheduled event.

**Arguments:**
- `eventUri` (string, required): Event URI to cancel
- `reason` (string, optional): Cancellation reason

**Example:**
```bash
curl -X POST -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventUri": "https://api.calendly.com/scheduled_events/XXXXX",
    "reason": "Customer requested rescheduling"
  }' \
  http://localhost:3000/api/servers/calendly/tools/cancel_event
```

## Security Features

### Rate Limiting
- 100 requests per 15 minutes per IP address
- Applies to all `/api/*` endpoints

### Security Headers
- Helmet.js middleware for secure HTTP headers
- CORS enabled for cross-origin requests

### Input Validation
- JSON body parsing with size limits
- Tool existence validation before execution

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

### Common HTTP Status Codes
- `200`: Success
- `400`: Bad request (invalid arguments)
- `401`: Unauthorized (invalid or missing API key)
- `404`: Not found (server or tool doesn't exist)
- `429`: Too many requests (rate limit exceeded)
- `500`: Internal server error

## Integration Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

const API_URL = 'http://localhost:3000';
const API_KEY = 'your-api-key';

async function addCustomer() {
  const response = await axios.post(
    `${API_URL}/api/servers/sheets/tools/add_customer_record`,
    {
      name: 'John Doe',
      email: 'john@example.com',
      issue: 'Login problem',
      status: 'open',
      priority: 'high'
    },
    {
      headers: { 'x-api-key': API_KEY }
    }
  );

  console.log(response.data);
}

addCustomer();
```

### Python

```python
import requests

API_URL = 'http://localhost:3000'
API_KEY = 'your-api-key'

def add_customer():
    response = requests.post(
        f'{API_URL}/api/servers/sheets/tools/add_customer_record',
        json={
            'name': 'John Doe',
            'email': 'john@example.com',
            'issue': 'Login problem',
            'status': 'open',
            'priority': 'high'
        },
        headers={'x-api-key': API_KEY}
    )

    print(response.json())

add_customer()
```

### cURL

```bash
# Set your API key
API_KEY="your-api-key"

# Add customer record
curl -X POST \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "issue": "Login problem",
    "status": "open",
    "priority": "high"
  }' \
  http://localhost:3000/api/servers/sheets/tools/add_customer_record
```

## Deployment Considerations

### Environment Variables
Ensure all required environment variables are set:
- Google Sheets credentials and spreadsheet ID
- Calendly API token and organization URI
- REST API port and API key (for production)

### HTTPS
For production, use a reverse proxy (nginx, Apache) or hosting platform that provides HTTPS.

### Process Management
Use a process manager like PM2 to keep the server running:

```bash
npm install -g pm2
pm2 start dist/rest-api.js --name crm-api
pm2 save
pm2 startup
```

### Monitoring
Monitor the server logs for errors and performance:

```bash
# View logs
pm2 logs crm-api

# Monitor
pm2 monit
```

## Troubleshooting

### Server won't start
- Check that all dependencies are installed: `npm install`
- Verify environment variables in `.env`
- Ensure port is not already in use

### Authentication errors
- Verify API key matches in `.env` and request headers
- Check that `x-api-key` header is being sent correctly

### MCP server not available
- Check Google Sheets credentials path and spreadsheet ID
- Verify Calendly API token and organization URI
- Check console output for initialization errors

### Rate limit errors
- Default limit is 100 requests per 15 minutes
- Implement request throttling in your client
- Consider increasing limits for production use

## License

MIT
