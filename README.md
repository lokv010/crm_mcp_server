# CRM MCP Server

A Model Context Protocol (MCP) server to automate customer support processes with integrated Google Sheets customer database and Calendly appointment booking.

## Features

### Google Sheets Integration
- Store and retrieve customer service records
- Add new customer records
- Update existing records
- Search by email, name, status, or priority
- Track issue status and priority levels
- Maintain full customer service history

### Calendly Integration
- List available appointment types
- Get scheduling links for customers
- View scheduled events
- Cancel appointments
- Access invitee details

### Email Notifications (SendGrid)
- Send appointment confirmation emails
- Send appointment reminder emails
- Send custom emails with personalized content
- Professional HTML email templates
- Automatic date/time formatting

## Prerequisites

- Node.js 18+ and npm
- Google Cloud Project with Sheets API enabled
- Google Service Account credentials
- Calendly account with API access
- SendGrid account with API key
- A Google Spreadsheet for customer records

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd crm_mcp_server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

### 1. Google Sheets Setup

#### Create a Google Cloud Project and Service Account:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Sheets API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

4. Create a Service Account:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the service account details
   - Click "Create and Continue"
   - Grant the service account the "Editor" role
   - Click "Done"

5. Create and Download Credentials:
   - Click on the created service account
   - Go to the "Keys" tab
   - Click "Add Key" > "Create New Key"
   - Select "JSON" format
   - Save the file as `credentials.json` in your project root

#### Create a Google Spreadsheet:

1. Create a new Google Spreadsheet
2. Share it with your service account email (found in credentials.json as `client_email`)
3. Copy the Spreadsheet ID from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
4. The first time you run the server, use the `initialize_sheet` tool to set up headers

### 2. Calendly Setup

1. Log in to your Calendly account
2. Go to [Integrations & API](https://calendly.com/integrations/api_webhooks)
3. Generate a Personal Access Token
4. Copy your organization URI:
   - You can get this from the API by calling `https://api.calendly.com/users/me` with your token
   - The response will include your organization URI

### 3. SendGrid Setup

1. Create a [SendGrid account](https://signup.sendgrid.com/) (free tier available)
2. Navigate to Settings > API Keys
3. Click "Create API Key"
4. Select "Full Access" or restrict to "Mail Send" only
5. Copy the generated API key
6. Verify a sender email address:
   - Go to Settings > Sender Authentication
   - Follow the steps to verify your email or domain

### 4. Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Google Sheets Configuration
GOOGLE_SHEETS_CREDENTIALS_PATH=./credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id_here

# Calendly Configuration
CALENDLY_API_TOKEN=your_calendly_api_token_here
CALENDLY_ORGANIZATION_URI=https://api.calendly.com/organizations/your_org_id

# SendGrid Email Configuration
SENDGRID_API_KEY=your_sendgrid_api_key_here
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=CRM Support

# MCP Server Configuration
MCP_SERVER_NAME=crm-mcp-server
# Options: sheets, calendly, email, all
MCP_SERVER_TYPE=all
```

## Usage

### Running the Server

Start both MCP servers:
```bash
npm start
```

Or run in development mode with watch:
```bash
npm run dev
```

### Viewing Connection Details

When you start the server, it automatically displays detailed connection information:

```bash
npm start
```

This will show:
- MCP server configuration
- Google Sheets credentials and spreadsheet details
- Calendly API configuration
- Complete MCP client configuration examples
- Integration options for OpenAI and other platforms

### Configuring in Claude Desktop

Add to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "crm-google-sheets": {
      "command": "node",
      "args": ["/path/to/crm_mcp_server/dist/index.js"],
      "env": {
        "MCP_SERVER_TYPE": "sheets",
        "GOOGLE_SHEETS_CREDENTIALS_PATH": "/path/to/credentials.json",
        "GOOGLE_SHEETS_SPREADSHEET_ID": "your_spreadsheet_id"
      }
    },
    "crm-calendly": {
      "command": "node",
      "args": ["/path/to/crm_mcp_server/dist/index.js"],
      "env": {
        "MCP_SERVER_TYPE": "calendly",
        "CALENDLY_API_TOKEN": "your_api_token",
        "CALENDLY_ORGANIZATION_URI": "your_org_uri"
      }
    },
    "crm-email": {
      "command": "node",
      "args": ["/path/to/crm_mcp_server/dist/index.js"],
      "env": {
        "MCP_SERVER_TYPE": "email",
        "SENDGRID_API_KEY": "your_api_key",
        "SENDGRID_FROM_EMAIL": "noreply@yourdomain.com",
        "SENDGRID_FROM_NAME": "CRM Support"
      }
    }
  }
}
```

### Integration with OpenAI Agent Builder

This MCP server uses stdio transport and is designed for MCP-compatible clients. For OpenAI Agent Builder integration, see **[OPENAI_INTEGRATION.md](./OPENAI_INTEGRATION.md)** which includes:

- How to extract and use credentials with OpenAI custom actions
- Direct API integration examples for Google Sheets and Calendly
- HTTP wrapper implementation guide
- Complete OpenAPI schemas for OpenAI actions
- Security best practices

## Available Tools

### Google Sheets Tools

#### `initialize_sheet`
Initialize the Google Sheet with proper headers. Run this first if the sheet is empty.

#### `add_customer_record`
Add a new customer service record.

**Parameters:**
- `name` (required): Customer name
- `email` (required): Customer email
- `phone` (optional): Phone number
- `issue` (required): Issue description
- `status` (required): One of: `open`, `in-progress`, `resolved`, `closed`
- `priority` (required): One of: `low`, `medium`, `high`, `urgent`
- `notes` (optional): Additional notes

**Example:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "issue": "Login issues with account",
  "status": "open",
  "priority": "high",
  "notes": "Customer reported multiple failed login attempts"
}
```

#### `get_customer_record`
Retrieve a specific customer record by ID.

**Parameters:**
- `id` (required): Record ID (row number)

#### `update_customer_record`
Update an existing customer record.

**Parameters:**
- `id` (required): Record ID to update
- Other fields are optional and will only update if provided

#### `search_customer_records`
Search for customer records.

**Parameters:**
- `email` (optional): Search by email
- `name` (optional): Search by name
- `status` (optional): Filter by status
- `priority` (optional): Filter by priority

#### `list_all_customers`
List all customer records in the database.

### Calendly Tools

#### `list_event_types`
List all available event types for booking.

#### `get_event_type`
Get details about a specific event type.

**Parameters:**
- `eventTypeUri` (required): Event type URI

#### `get_scheduling_link`
Get the scheduling link to share with customers.

**Parameters:**
- `eventTypeUri` (required): Event type URI

#### `list_scheduled_events`
List scheduled events with optional filters.

**Parameters:**
- `status` (optional): Filter by `active` or `canceled`
- `minStartTime` (optional): ISO 8601 datetime
- `maxStartTime` (optional): ISO 8601 datetime

#### `get_event_invitee`
Get details about event invitees.

**Parameters:**
- `inviteeUri` (required): Invitee URI

#### `cancel_event`
Cancel a scheduled event.

**Parameters:**
- `eventUri` (required): Event URI
- `reason` (optional): Cancellation reason

### Email Tools

#### `send_appointment_confirmation`
Send a professional appointment confirmation email with all booking details.

**Parameters:**
- `to` (required): Recipient email address
- `subject` (optional): Email subject line (auto-generated if not provided)
- `customerName` (required): Customer name for personalization
- `appointmentDetails` (required): Object containing:
  - `eventType` (required): Type of appointment/event
  - `startTime` (required): Appointment start time (ISO 8601 format)
  - `endTime` (optional): Appointment end time (ISO 8601 format)
  - `timezone` (required): Timezone for the appointment
  - `location` (optional): Meeting location or link
- `additionalInfo` (optional): Additional information or notes

**Example:**
```json
{
  "to": "customer@example.com",
  "customerName": "John Doe",
  "appointmentDetails": {
    "eventType": "Technical Support Session",
    "startTime": "2025-12-01T14:00:00Z",
    "endTime": "2025-12-01T15:00:00Z",
    "timezone": "America/New_York",
    "location": "https://zoom.us/j/123456789"
  },
  "additionalInfo": "Please prepare any error messages or screenshots before the call."
}
```

#### `send_appointment_reminder`
Send an appointment reminder email before the scheduled appointment.

**Parameters:** Same as `send_appointment_confirmation`

#### `send_custom_email`
Send a custom email with specified content.

**Parameters:**
- `to` (required): Recipient email address
- `subject` (required): Email subject line
- `text` (required): Plain text email content
- `html` (optional): HTML email content

## Example Workflows

### Customer Support Workflow

1. Customer contacts support
2. Use `add_customer_record` to create a record with their issue
3. Use `list_event_types` to find appropriate appointment types
4. Use `get_scheduling_link` to get a booking link
5. Share the link with the customer
6. When appointment is booked, use `send_appointment_confirmation` to send confirmation email
7. Use `update_customer_record` to update status as the issue progresses
8. Use `send_appointment_reminder` to remind customers before appointments
9. Use `list_scheduled_events` to view upcoming appointments

### Searching Customer History

1. Use `search_customer_records` with email to find all records for a customer
2. Use `get_customer_record` to get full details
3. Use `update_customer_record` to add notes or change status

## Development

### Project Structure

```
crm_mcp_server/
├── src/
│   ├── index.ts              # Main entry point
│   ├── sheets-server.ts      # Google Sheets MCP server
│   ├── calendly-server.ts    # Calendly MCP server
│   ├── email-server.ts       # Email notifications MCP server
│   └── types.ts              # TypeScript interfaces
├── dist/                     # Compiled JavaScript
├── .env.example              # Environment template
├── package.json
└── tsconfig.json
```

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

## Troubleshooting

### Google Sheets Issues

- **Permission denied**: Ensure the spreadsheet is shared with the service account email
- **Invalid credentials**: Verify the credentials.json file path and contents
- **Sheet not found**: Run `initialize_sheet` to create the sheet

### Calendly Issues

- **Invalid token**: Verify your API token is correct and active
- **Organization not found**: Check your organization URI format
- **Rate limiting**: Calendly has API rate limits, wait and retry

### SendGrid Email Issues

- **Authentication failed**: Verify your SendGrid API key is correct
- **Sender email not verified**: You must verify your sender email in SendGrid settings
- **Email not received**: Check spam folder, verify recipient email address
- **Template errors**: Check that all required fields are provided in appointmentDetails

## Security Notes

- Never commit your `.env` file or `credentials.json` to version control
- Keep your API tokens and credentials secure
- Use environment variables in production
- Rotate API tokens periodically
- Grant minimum necessary permissions to service accounts

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
