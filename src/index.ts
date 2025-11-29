#!/usr/bin/env node

import { GoogleSheetsMCPServer } from './sheets-server.js';
import { CalendlyMCPServer } from './calendly-server.js';
import * as dotenv from 'dotenv';

dotenv.config();

const SERVER_TYPE = process.env.MCP_SERVER_TYPE || 'all';

async function main() {
  try {
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

    if (SERVER_TYPE !== 'sheets' && SERVER_TYPE !== 'calendly' && SERVER_TYPE !== 'all') {
      console.error(`Error: Invalid MCP_SERVER_TYPE: ${SERVER_TYPE}`);
      console.error('Valid options are: sheets, calendly, all');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
