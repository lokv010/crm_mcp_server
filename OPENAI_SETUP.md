# OpenAI Agent Builder Setup Guide

## Problem: 424 Error - "Failed Dependency"

The error occurs because **OpenAI Agent Builder is a cloud service** and cannot access `localhost` on your local machine. When you use `http://localhost:3000/api/tools`, OpenAI's servers try to connect to *their own* localhost, not yours.

## Solution: Expose Your Local Server

You have two options:

### Option 1: Use ngrok (Recommended for Testing)

ngrok creates a secure tunnel to your local server, making it accessible from the internet.

#### Steps:

1. **Install ngrok** (if not already installed):
   ```bash
   # macOS
   brew install ngrok

   # Or download from: https://ngrok.com/download
   ```

2. **Start your MCP server**:
   ```bash
   npm run start:api
   ```

3. **In a new terminal, start ngrok**:
   ```bash
   ngrok http 3000
   ```

4. **Copy the public URL** from ngrok's output:
   ```
   Forwarding    https://abc123.ngrok.io -> http://localhost:3000
   ```

5. **Use the ngrok URL in OpenAI Agent Builder**:
   - Server URL: `https://abc123.ngrok.io/api/tools`
   - Custom header: `x-api-key` = (your API key from .env)

#### Important Notes:
- The ngrok URL changes each time you restart ngrok (free plan)
- ngrok sessions expire after 2 hours on the free plan
- For production, use a paid ngrok plan or deploy to cloud

### Option 2: Deploy to Cloud (Recommended for Production)

Deploy your server to a cloud platform:

**Recommended platforms:**
- **Railway**: Easy deployment, free tier available
- **Render**: Free tier with persistent URLs
- **Fly.io**: Free tier, good for Node.js apps
- **AWS EC2**: More control, requires setup
- **Google Cloud Run**: Serverless, pay-per-use
- **Heroku**: Simple deployment (no longer free)

#### Example: Deploy to Railway

1. Install Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Login and deploy:
   ```bash
   railway login
   railway init
   railway up
   ```

3. Add environment variables in Railway dashboard:
   - `GOOGLE_SHEETS_CREDENTIALS_PATH`
   - `GOOGLE_SHEETS_SPREADSHEET_ID`
   - `CALENDLY_API_TOKEN`
   - `CALENDLY_ORGANIZATION_URI`
   - `REST_API_KEY`
   - `REST_API_PORT` (Railway will provide this)

4. Get your deployment URL from Railway dashboard

5. Use in OpenAI Agent Builder:
   - Server URL: `https://your-app.railway.app/api/tools`
   - Custom header: `x-api-key` = (your API key)

## Configuration Checklist

Before connecting to OpenAI Agent Builder:

### 1. Configure Environment Variables

Edit your `.env` file:

```bash
# Google Sheets (if using)
GOOGLE_SHEETS_CREDENTIALS_PATH=./google_cred/your-credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id

# Calendly (if using)
CALENDLY_API_TOKEN=your-calendly-token
CALENDLY_ORGANIZATION_URI=https://api.calendly.com/organizations/your-org-id

# REST API Configuration
REST_API_PORT=3000
REST_API_KEY=your-secret-api-key-here  # CHANGE THIS!
```

### 2. Verify Server is Running

Start the server:
```bash
npm run start:api
```

You should see:
```
🚀 CRM MCP REST API Server
Server running on: http://localhost:3000
Available MCP servers: sheets, calendly
🔒 API Key authentication: ENABLED
```

### 3. Test Locally

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Test the tools endpoint with your API key:
```bash
curl -H "x-api-key: your-secret-api-key-here" http://localhost:3000/api/tools
```

You should get a JSON response with available tools.

### 4. Connect to OpenAI Agent Builder

1. **Server URL**:
   - Local + ngrok: `https://your-ngrok-url.ngrok.io/api/tools`
   - Deployed: `https://your-domain.com/api/tools`

2. **Custom Headers**:
   - Key: `x-api-key`
   - Value: Your API key from `.env` file

3. **Approval**: Set to "Always require approval for all tool calls"

4. Click "Add" to connect

## Troubleshooting

### Error: "Unable to load tools"

**Possible causes:**

1. **Server not accessible**
   - Check if server is running: `curl http://localhost:3000/health`
   - Check if ngrok is running and forwarding correctly
   - Test ngrok URL: `curl https://your-ngrok-url.ngrok.io/health`

2. **Wrong API key**
   - Verify the `x-api-key` header matches `REST_API_KEY` in your `.env`
   - Check server logs for authentication errors

3. **No MCP servers configured**
   - Check that `.env` has valid credentials for at least one service
   - Verify credentials files exist (for Google Sheets)
   - Check server logs on startup for initialization messages

4. **Firewall/Network issues**
   - Ensure your firewall allows outbound connections
   - Check if ngrok can establish tunnel
   - Verify cloud deployment has correct ports open

### Error: "424 Failed Dependency"

This error means OpenAI cannot reach your server. This happens when:
- Using `localhost` without ngrok/tunnel
- ngrok session expired
- Server is not running
- Network/firewall blocking connection

**Solution**: Use ngrok or deploy to cloud (see above)

### Server logs show "No MCP servers configured"

Check your `.env` file has valid credentials:
```bash
# Check .env exists
ls -la .env

# Verify Google Sheets credentials file exists
ls -la ./google_cred/

# Check environment variables are loaded
npm run start:api  # Look for initialization messages
```

## Security Best Practices

1. **Use strong API keys**: Generate random, long API keys
   ```bash
   # Generate a random API key
   openssl rand -hex 32
   ```

2. **Don't commit secrets**: Ensure `.env` is in `.gitignore`

3. **Use HTTPS**: Always use HTTPS URLs (ngrok provides this automatically)

4. **Rotate keys regularly**: Change your `REST_API_KEY` periodically

5. **Monitor usage**: Check server logs for suspicious activity

6. **Rate limiting**: The server has built-in rate limiting (100 requests per 15 min)

## Next Steps

Once connected:

1. **Test with OpenAI**: Try calling a tool from the OpenAI Agent Builder
2. **Monitor logs**: Watch server logs for any errors
3. **Set up Google Sheets**: Ensure your service account has access to the spreadsheet
4. **Configure Calendly**: Verify your API token has correct permissions
5. **Build your agent**: Create custom workflows using the available tools

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test endpoints manually with curl
4. Check firewall and network settings
5. Review ngrok/deployment platform documentation

For more information:
- MCP SDK: https://github.com/anthropics/mcp
- ngrok docs: https://ngrok.com/docs
- OpenAI Agent Builder: https://platform.openai.com/docs/assistants/overview
