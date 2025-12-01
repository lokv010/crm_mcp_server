# CRM MCP Server

A Model Context Protocol (MCP) server for customer relationship management with Google Sheets integration, Calendly appointment booking, and email notifications via SendGrid.

**✓ Full MCP Protocol Support** - Works with OpenAI Agent Builder and Claude Desktop

## Features

- **Google Sheets CRM**: Store and manage customer service records
- **Calendly Integration**: Schedule appointments and manage bookings
- **Email Notifications**: Send appointment confirmations and reminders via SendGrid
- **MCP Protocol**: Native MCP server with HTTP/SSE transport for OpenAI Agent Builder
- **Stdio Transport**: Traditional MCP server for Claude Desktop

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Google Sheets Credentials

Follow the detailed instructions in [google_cred/README.md](./google_cred/README.md) to:
1. Create a Google Cloud project
2. Enable Google Sheets API
3. Create a service account and download credentials
4. Place credentials in `google_cred/credentials.json`
5. Share your spreadsheet with the service account email

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Google Sheets (Required)
GOOGLE_SHEETS_CREDENTIALS_PATH=./google_cred/credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here

# Calendly (Optional)
CALENDLY_API_TOKEN=your_calendly_api_token
CALENDLY_ORGANIZATION_URI=https://api.calendly.com/organizations/your_org_id

# SendGrid Email (Optional)
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=CRM Support

# REST API Configuration
REST_API_PORT=3000
REST_API_KEY=your-secret-api-key-here
```

### 4. Build the Project

```bash
npm run build
```

## Usage

### For OpenAI Agent Builder (MCP Protocol)

**This is the recommended way to use this server with OpenAI.**

Start the MCP server:

```bash
npm run start:mcp
```

The server will run on `http://localhost:3100/mcp` by default.

**Configure OpenAI Agent Builder:**

1. In OpenAI Agent Builder, add a new action
2. Select "Connect to MCP Server"
3. Enter the server URL: `http://localhost:3100/mcp`
4. OpenAI will automatically discover all available tools via the MCP protocol

**Verify it's working:**
- Health check: `http://localhost:3100/health`
- The server logs will show "Session initialized" when OpenAI connects
- OpenAI Agent Builder should list all tools (Google Sheets, Calendly, Email)

**What tools will be available?**
- All Google Sheets CRM tools (if configured)
- All Calendly appointment tools (if configured)
- All SendGrid email tools (if configured)

### For MCP Clients (Claude Desktop)

Start the MCP server:

```bash
npm start
```

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "crm-server": {
      "command": "node",
      "args": ["/path/to/crm_mcp_server/dist/index.js"],
      "env": {
        "MCP_SERVER_TYPE": "all",
        "GOOGLE_SHEETS_CREDENTIALS_PATH": "/path/to/credentials.json",
        "GOOGLE_SHEETS_SPREADSHEET_ID": "your_spreadsheet_id"
      }
    }
  }
}
```

## Available Tools

### Google Sheets Tools

- `initialize_sheet` - Set up sheet with headers (run once)
- `add_customer_record` - Add new customer support ticket
- `get_customer_record` - Retrieve specific record by ID
- `update_customer_record` - Update existing record
- `search_customer_records` - Search by email, name, status, or priority
- `list_all_customers` - Get all customer records

### Calendly Tools

- `list_event_types` - List available appointment types
- `get_event_type` - Get details about an event type
- `get_scheduling_link` - Get booking link for customers
- `list_scheduled_events` - View scheduled appointments
- `get_event_invitee` - Get invitee details
- `cancel_event` - Cancel an appointment

### Email Tools

- `send_appointment_confirmation` - Send appointment confirmation email
- `send_appointment_reminder` - Send appointment reminder
- `send_custom_email` - Send custom email

## How to Choose the Right Server Mode

**Use `npm run start:mcp`** (Port 3100) - **RECOMMENDED**
- ✓ For OpenAI Agent Builder
- ✓ Implements proper MCP protocol with HTTP/SSE transport
- ✓ OpenAI can auto-discover all tools
- ✓ Native MCP communication

**Use `npm start`** (stdio)
- ✓ For Claude Desktop
- ✓ Uses stdio transport
- ✓ Add to claude_desktop_config.json

**Use `npm run start:api`** (Port 3000) - **DEPRECATED**
- ✗ REST API wrapper (not true MCP protocol)
- ✗ Does NOT work with OpenAI Agent Builder
- ✗ Legacy compatibility only

## API Authentication

If you set `REST_API_KEY` in `.env`, include it in all requests:

```bash
curl -H "x-api-key: your-api-key" http://localhost:3000/api/tools
```

Or disable authentication by leaving `REST_API_KEY` empty.

## Project Structure

```
crm_mcp_server/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── rest-api.ts           # REST API server
│   ├── mcp-bridge.ts         # MCP to REST adapter
│   ├── sheets-server.ts      # Google Sheets integration
│   ├── calendly-server.ts    # Calendly integration
│   ├── email-server.ts       # Email notifications
│   └── types.ts              # TypeScript interfaces
├── google_cred/
│   └── README.md             # Google credentials setup guide
├── openai-api-spec.yaml      # OpenAPI spec for OpenAI agents
├── .env.example              # Environment template
└── README.md                 # This file
```

## Troubleshooting

### Google Sheets Permission Denied
- Ensure spreadsheet is shared with service account email
- Check that `credentials.json` path is correct

### API Authentication Failed
- Verify `REST_API_KEY` matches in `.env` and request headers
- Or remove `REST_API_KEY` to disable authentication

### Server Won't Start
- Run `npm install` to ensure all dependencies are installed
- Check that all required environment variables are set
- Verify credentials files exist at specified paths

## Security Notes

- Never commit `.env` or `credentials.json` to version control
- Use strong API keys in production
- Enable HTTPS when deploying to production
- Rotate API tokens periodically

## License

MIT
