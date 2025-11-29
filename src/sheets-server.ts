import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import { CustomerRecord } from './types.js';
import * as fs from 'fs';

const SHEET_NAME = 'CustomerRecords';
const HEADERS = ['ID', 'Name', 'Email', 'Phone', 'Issue', 'Status', 'Priority', 'Created At', 'Updated At', 'Notes'];

export class GoogleSheetsMCPServer {
  private server: Server;
  private sheets;
  private spreadsheetId: string;

  constructor(credentialsPath: string, spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;

    // Initialize Google Sheets API
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });

    // Initialize MCP Server
    this.server = new Server(
      {
        name: 'google-sheets-crm',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'add_customer_record':
            return await this.addCustomerRecord(args as CustomerRecord);
          case 'get_customer_record':
            return await this.getCustomerRecord(args.id as string);
          case 'update_customer_record':
            return await this.updateCustomerRecord(args as CustomerRecord & { id: string });
          case 'search_customer_records':
            return await this.searchCustomerRecords(args);
          case 'list_all_customers':
            return await this.listAllCustomers();
          case 'initialize_sheet':
            return await this.initializeSheet();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
        };
      }
    });
  }

  private getTools(): Tool[] {
    return [
      {
        name: 'initialize_sheet',
        description: 'Initialize the Google Sheet with proper headers for customer records. Run this first if the sheet is empty.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'add_customer_record',
        description: 'Add a new customer service record to the Google Sheet',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Customer name',
            },
            email: {
              type: 'string',
              description: 'Customer email address',
            },
            phone: {
              type: 'string',
              description: 'Customer phone number',
            },
            issue: {
              type: 'string',
              description: 'Description of the customer issue',
            },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'resolved', 'closed'],
              description: 'Current status of the issue',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level of the issue',
            },
            notes: {
              type: 'string',
              description: 'Additional notes about the issue',
            },
          },
          required: ['name', 'email', 'issue', 'status', 'priority'],
        },
      },
      {
        name: 'get_customer_record',
        description: 'Retrieve a specific customer record by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The customer record ID (row number)',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'update_customer_record',
        description: 'Update an existing customer record',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The customer record ID to update',
            },
            name: {
              type: 'string',
              description: 'Customer name',
            },
            email: {
              type: 'string',
              description: 'Customer email address',
            },
            phone: {
              type: 'string',
              description: 'Customer phone number',
            },
            issue: {
              type: 'string',
              description: 'Description of the customer issue',
            },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'resolved', 'closed'],
              description: 'Current status of the issue',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level of the issue',
            },
            notes: {
              type: 'string',
              description: 'Additional notes about the issue',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_customer_records',
        description: 'Search customer records by email, name, status, or priority',
        inputSchema: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              description: 'Search by customer email',
            },
            name: {
              type: 'string',
              description: 'Search by customer name',
            },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'resolved', 'closed'],
              description: 'Filter by status',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Filter by priority',
            },
          },
        },
      },
      {
        name: 'list_all_customers',
        description: 'List all customer records in the database',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  private async initializeSheet() {
    try {
      // Check if sheet exists
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = spreadsheet.data.sheets?.find(
        (s) => s.properties?.title === SHEET_NAME
      );

      if (!sheet) {
        // Create the sheet
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: SHEET_NAME,
                  },
                },
              },
            ],
          },
        });
      }

      // Add headers
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_NAME}!A1:J1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [HEADERS],
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: 'Google Sheet initialized successfully with headers',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to initialize sheet: ${error}`);
    }
  }

  private async addCustomerRecord(record: CustomerRecord) {
    const timestamp = new Date().toISOString();
    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          [
            '', // ID will be row number
            record.name,
            record.email,
            record.phone || '',
            record.issue,
            record.status,
            record.priority,
            timestamp,
            timestamp,
            record.notes || '',
          ],
        ],
      },
    });

    const updatedRange = response.data.updates?.updatedRange;
    const rowNumber = updatedRange?.match(/\d+$/)?.[0];

    if (rowNumber) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${SHEET_NAME}!A${rowNumber}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[rowNumber]],
        },
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: `Customer record added successfully with ID: ${rowNumber}`,
        },
      ],
    };
  }

  private async getCustomerRecord(id: string) {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A${id}:J${id}`,
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      throw new Error(`No customer record found with ID: ${id}`);
    }

    const [recordId, name, email, phone, issue, status, priority, createdAt, updatedAt, notes] = values[0];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              id: recordId,
              name,
              email,
              phone,
              issue,
              status,
              priority,
              createdAt,
              updatedAt,
              notes,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async updateCustomerRecord(record: CustomerRecord & { id: string }) {
    const timestamp = new Date().toISOString();

    // Get current record
    const current = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A${record.id}:J${record.id}`,
    });

    if (!current.data.values || current.data.values.length === 0) {
      throw new Error(`No customer record found with ID: ${record.id}`);
    }

    const [recordId, currentName, currentEmail, currentPhone, currentIssue, currentStatus, currentPriority, createdAt, , currentNotes] = current.data.values[0];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A${record.id}:J${record.id}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          [
            recordId,
            record.name || currentName,
            record.email || currentEmail,
            record.phone !== undefined ? record.phone : currentPhone,
            record.issue || currentIssue,
            record.status || currentStatus,
            record.priority || currentPriority,
            createdAt,
            timestamp,
            record.notes !== undefined ? record.notes : currentNotes,
          ],
        ],
      },
    });

    return {
      content: [
        {
          type: 'text',
          text: `Customer record ${record.id} updated successfully`,
        },
      ],
    };
  }

  private async searchCustomerRecords(criteria: Partial<CustomerRecord>) {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A2:J`,
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No customer records found',
          },
        ],
      };
    }

    const filtered = values.filter((row) => {
      const [, name, email, , , status, priority] = row;

      if (criteria.email && !email.toLowerCase().includes(criteria.email.toLowerCase())) {
        return false;
      }
      if (criteria.name && !name.toLowerCase().includes(criteria.name.toLowerCase())) {
        return false;
      }
      if (criteria.status && status !== criteria.status) {
        return false;
      }
      if (criteria.priority && priority !== criteria.priority) {
        return false;
      }

      return true;
    });

    const results = filtered.map((row) => ({
      id: row[0],
      name: row[1],
      email: row[2],
      phone: row[3],
      issue: row[4],
      status: row[5],
      priority: row[6],
      createdAt: row[7],
      updatedAt: row[8],
      notes: row[9],
    }));

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} matching records:\n${JSON.stringify(results, null, 2)}`,
        },
      ],
    };
  }

  private async listAllCustomers() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${SHEET_NAME}!A2:J`,
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No customer records found',
          },
        ],
      };
    }

    const records = values.map((row) => ({
      id: row[0],
      name: row[1],
      email: row[2],
      phone: row[3],
      issue: row[4],
      status: row[5],
      priority: row[6],
      createdAt: row[7],
      updatedAt: row[8],
      notes: row[9],
    }));

    return {
      content: [
        {
          type: 'text',
          text: `Total records: ${records.length}\n${JSON.stringify(records, null, 2)}`,
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Google Sheets MCP server running on stdio');
  }
}
