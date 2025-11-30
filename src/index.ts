#!/usr/bin/env node

import { GoogleSheetsMCPServer } from './sheets-server.js';
import { CalendlyMCPServer } from './calendly-server.js';
import { EmailMCPServer } from './email-server.js';
import * as dotenv from 'dotenv';

dotenv.config();

const SERVER_TYPE = process.env.MCP_SERVER_TYPE || 'all';

function logConnectionDetails() {
  console.error('\n========================================');
  console.error('MCP SERVER CONNECTION DETAILS');
  console.error('========================================\n');

  console.error(`Server Type: ${SERVER_TYPE}`);
  console.error(`Protocol: MCP over stdio`);
  console.error(`Node Path: ${process.execPath}`);
  console.error(`Server Path: ${process.argv[1]}`);

  if (SERVER_TYPE === 'sheets' || SERVER_TYPE === 'all') {
    console.error('\n--- Google Sheets Configuration ---');
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (credentialsPath && spreadsheetId) {
      console.error(`Credentials Path: ${credentialsPath}`);
      console.error(`Spreadsheet ID: ${spreadsheetId}`);
      console.error(`Spreadsheet URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);

      // Try to read and display service account email
      try {
        const fs = require('fs');
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
        console.error(`Service Account Email: ${credentials.client_email}`);
        console.error(`Project ID: ${credentials.project_id}`);
      } catch (e) {
        console.error('Could not read credentials file details');
      }
    }
  }

  if (SERVER_TYPE === 'calendly' || SERVER_TYPE === 'all') {
    console.error('\n--- Calendly Configuration ---');
    const apiToken = process.env.CALENDLY_API_TOKEN;
    const organizationUri = process.env.CALENDLY_ORGANIZATION_URI;

    if (apiToken && organizationUri) {
      // Show masked token for security
      const maskedToken = apiToken.substring(0, 8) + '...' + apiToken.substring(apiToken.length - 4);
      console.error(`API Token: ${maskedToken} (masked)`);
      console.error(`Organization URI: ${organizationUri}`);
      console.error(`API Base URL: https://api.calendly.com`);
    }
  }

  if (SERVER_TYPE === 'email' || SERVER_TYPE === 'all') {
    console.error('\n--- Email Configuration (SendGrid) ---');
    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const fromName = process.env.SENDGRID_FROM_NAME;

    if (apiKey && fromEmail) {
      // Show masked API key for security
      const maskedKey = apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4);
      console.error(`API Key: ${maskedKey} (masked)`);
      console.error(`From Email: ${fromEmail}`);
      console.error(`From Name: ${fromName || 'CRM Support'}`);
    }
  }

  console.error('\n--- MCP Client Configuration Example ---');
  console.error('For Claude Desktop (claude_desktop_config.json):');
  console.error(JSON.stringify({
    mcpServers: {
      "crm-server": {
        command: "node",
        args: [process.argv[1]],
        env: {
          MCP_SERVER_TYPE: SERVER_TYPE,
          ...(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH && {
            GOOGLE_SHEETS_CREDENTIALS_PATH: process.env.GOOGLE_SHEETS_CREDENTIALS_PATH,
            GOOGLE_SHEETS_SPREADSHEET_ID: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
          }),
          ...(process.env.CALENDLY_API_TOKEN && {
            CALENDLY_API_TOKEN: process.env.CALENDLY_API_TOKEN,
            CALENDLY_ORGANIZATION_URI: process.env.CALENDLY_ORGANIZATION_URI
          }),
          ...(process.env.SENDGRID_API_KEY && {
            SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
            SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL,
            SENDGRID_FROM_NAME: process.env.SENDGRID_FROM_NAME
          })
        }
      }
    }
  }, null, 2));

  console.error('\n--- OpenAI Integration ---');
  console.error('NOTE: This is an MCP server using stdio transport.');
  console.error('OpenAI Agent Builder does not natively support MCP servers.');
  console.error('See OPENAI_INTEGRATION.md for integration options.\n');

  console.error('========================================\n');
}

async function main() {
  try {
    // Log connection details at startup
    logConnectionDetails();

    if (SERVER_TYPE === 'sheets' || SERVER_TYPE === 'all') {
      const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

      if (!credentialsPath || !spreadsheetId) {
        console.error('Error: Google Sheets configuration missing');
        console.error('Please set GOOGLE_SHEETS_CREDENTIALS_PATH and GOOGLE_SHEETS_SPREADSHEET_ID in .env');
        if (SERVER_TYPE === 'sheets') {
          process.exit(1);
        }
      } else {
        const sheetsServer = new GoogleSheetsMCPServer(credentialsPath, spreadsheetId);
        await sheetsServer.start();
      }
    }

    if (SERVER_TYPE === 'calendly' || SERVER_TYPE === 'all') {
      const apiToken = process.env.CALENDLY_API_TOKEN;
      const organizationUri = process.env.CALENDLY_ORGANIZATION_URI;

      if (!apiToken || !organizationUri) {
        console.error('Error: Calendly configuration missing');
        console.error('Please set CALENDLY_API_TOKEN and CALENDLY_ORGANIZATION_URI in .env');
        if (SERVER_TYPE === 'calendly') {
          process.exit(1);
        }
      } else {
        const calendlyServer = new CalendlyMCPServer(apiToken, organizationUri);
        await calendlyServer.start();
      }
    }

    if (SERVER_TYPE === 'email' || SERVER_TYPE === 'all') {
      const apiKey = process.env.SENDGRID_API_KEY;
      const fromEmail = process.env.SENDGRID_FROM_EMAIL;
      const fromName = process.env.SENDGRID_FROM_NAME || 'CRM Support';

      if (!apiKey || !fromEmail) {
        console.error('Error: SendGrid configuration missing');
        console.error('Please set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL in .env');
        if (SERVER_TYPE === 'email') {
          process.exit(1);
        }
      } else {
        const emailServer = new EmailMCPServer(apiKey, fromEmail, fromName);
        await emailServer.start();
      }
    }

    if (SERVER_TYPE !== 'sheets' && SERVER_TYPE !== 'calendly' && SERVER_TYPE !== 'email' && SERVER_TYPE !== 'all') {
      console.error(`Error: Invalid MCP_SERVER_TYPE: ${SERVER_TYPE}`);
      console.error('Valid options are: sheets, calendly, email, all');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
