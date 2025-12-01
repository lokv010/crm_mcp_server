# OpenAI Agent Builder Setup Guide

## ✅ Server Status: READY

Your MCP server is now running and ready for OpenAI Agent Builder integration!

```
Server URL: http://localhost:3000
OpenAPI Spec: http://localhost:3000/openapi.json
Status: ✅ RUNNING (8 Calendly tools available)
Authentication: DISABLED (for OpenAI compatibility)
```

---

## Quick Start for OpenAI Agent Builder

### Step 1: Import the OpenAPI Specification

In your OpenAI Agent Builder, import the MCP server using this URL:

```
http://localhost:3000/openapi.json
```

**Alternative:** You can also upload the OpenAPI spec file:
```
/home/user/crm_mcp_server/openai-api-spec.yaml
```

### Step 2: Test the Connection

The OpenAI Agent should now detect **8 available tools**:

#### Calendly Tools (Currently Available ✅)

1. **list_event_types** - List available appointment types
2. **get_event_type** - Get event type details
3. **get_scheduling_link** - Get booking link for customers
4. **list_scheduled_events** - View scheduled appointments
5. **get_event_invitee** - Get invitee details
6. **cancel_event** - Cancel an appointment
7. **check_availability** - Check available time slots
8. **book_appointment** - Generate pre-filled booking link

### Step 3: Test with a Simple Query

Ask your OpenAI Agent:

```
"List all available Calendly event types"
```

The agent should call:
```
POST /api/servers/calendly/tools/list_event_types
```

---

## Available Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### List All Servers
```bash
curl http://localhost:3000/api/servers
```

### List All Tools
```bash
curl http://localhost:3000/api/tools
```

### Execute a Tool
```bash
curl -X POST http://localhost:3000/api/servers/calendly/tools/list_event_types
```

---

## Adding Google Sheets CRM Tools (Optional)

Currently, only **Calendly tools** are available. To enable **Google Sheets CRM tools**, follow these steps:

### 1. Create Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Sheets API**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

### 2. Create Service Account Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in details and grant "Editor" role
4. Go to the "Keys" tab
5. Click "Add Key" > "Create new key"
6. Select **JSON** format
7. Save the downloaded file as:
   ```
   /home/user/crm_mcp_server/google_cred/credentials.json
   ```

### 3. Share Your Google Sheet

1. Open the `credentials.json` file and copy the `client_email`:
   ```
   your-service-account@your-project.iam.gserviceaccount.com
   ```

2. Create or open your Google Sheet for CRM data

3. Click **Share** and add the service account email

4. Give it **Editor** permissions

5. Copy the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit
   ```

### 4. Update Environment Configuration

Edit `/home/user/crm_mcp_server/.env`:

```env
# Update these lines:
GOOGLE_SHEETS_CREDENTIALS_PATH=./google_cred/credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_actual_spreadsheet_id_here
```

### 5. Restart the Server

```bash
# Kill the current server
pkill -f "node dist/rest-api.js"

# Restart
npm run start:api
```

### 6. Verify Google Sheets Tools

After restarting, you should see **14 total tools** (8 Calendly + 6 Google Sheets):

```bash
curl http://localhost:3000/api/tools | jq '.tools.sheets | length'
# Should return: 6
```

**Google Sheets CRM Tools:**
1. `initialize_sheet` - Set up sheet with headers
2. `add_customer_record` - Add new customer support ticket
3. `get_customer_record` - Retrieve specific record by ID
4. `update_customer_record` - Update existing record
5. `search_customer_records` - Search by email, name, status, or priority
6. `list_all_customers` - Get all customer records

---

## Testing with cURL

### Example: List Event Types
```bash
curl -X POST http://localhost:3000/api/servers/calendly/tools/list_event_types
```

### Example: Check Availability
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "eventTypeUri": "https://api.calendly.com/event_types/YOUR_EVENT_TYPE",
    "startTime": "2025-12-01T00:00:00Z",
    "endTime": "2025-12-08T23:59:59Z"
  }' \
  http://localhost:3000/api/servers/calendly/tools/check_availability
```

### Example: Book Appointment (Generate Link)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "eventTypeUri": "https://api.calendly.com/event_types/YOUR_EVENT_TYPE",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "555-1234"
  }' \
  http://localhost:3000/api/servers/calendly/tools/book_appointment
```

---

## Troubleshooting

### OpenAI Can't Connect

**Check server is running:**
```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "...",
  "servers": ["calendly"]
}
```

### 424 Error: Failed Dependency

This error occurs when:
- Server is not running
- MCP servers fail to initialize
- No tools are available

**Solution:** Check server logs for initialization errors

### Google Sheets Tools Not Appearing

**Common causes:**
- Missing `credentials.json` file
- Incorrect spreadsheet ID in `.env`
- Service account not shared with spreadsheet
- Invalid credentials

**Check logs:**
```bash
# Look for initialization errors in server output
```

---

## Security Notes

### Current Configuration
- ✅ Authentication: **DISABLED** (for OpenAI Agent Builder)
- ⚠️  Only use on localhost or trusted networks
- ⚠️  Do not expose to public internet without authentication

### Enabling Authentication (Production)

If deploying to production, enable API key authentication:

1. Edit `.env`:
   ```env
   REST_API_KEY=your-strong-secret-key-here
   ```

2. Restart server

3. Include API key in all requests:
   ```bash
   curl -H "x-api-key: your-strong-secret-key-here" http://localhost:3000/api/tools
   ```

---

## Support

- **Documentation:** http://localhost:3000/api/docs
- **OpenAPI Spec:** http://localhost:3000/openapi.json
- **Repository:** /home/user/crm_mcp_server

For detailed Google Sheets setup instructions:
```
/home/user/crm_mcp_server/google_cred/README.md
```
