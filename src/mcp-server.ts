#!/usr/bin/env node

/**
 * MCP Server with Streamable HTTP Transport
 *
 * This MCP server implements the Model Context Protocol specification (2025-03-26)
 * using the Streamable HTTP transport pattern recommended for remote servers.
 *
 * Key features:
 * - Single /mcp endpoint supporting both POST (JSON-RPC) and GET (SSE) requests
 * - Session management via Mcp-Session-Id header
 * - Origin and Accept header validation for security and compliance
 * - Compatible with OpenAI Agent Builder and ChatGPT Apps
 *
 * The server aggregates tools from:
 * - Google Sheets CRM: Customer record management
 * - Calendly: Appointment scheduling and management
 * - SendGrid: Email notifications (confirmations, reminders, custom emails)
 *
 * References:
 * - MCP Streamable HTTP spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 * - OpenAI MCP guide: https://developers.openai.com/apps-sdk/build/mcp-server/
 */

import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';
import * as fs from 'fs';
import { CustomerRecord } from './types.js';
import sgMail from '@sendgrid/mail';


dotenv.config();

const MCP_PORT = parseInt(process.env.MCP_PORT || '3100', 10);

// Configuration validation
const GOOGLE_SHEETS_CREDENTIALS_PATH = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
const GOOGLE_SHEETS_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const CALENDLY_ORGANIZATION_URI = process.env.CALENDLY_ORGANIZATION_URI;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || 'CRM Support';

// Google Sheets configuration
const SHEET_NAME = 'CustomerRecords';
const HEADERS = [
  'ID',
  'Make',
  'Model',
  'KM',
  'Name',
  'Email',
  'Phone',
  'Issue',
  'Status',
  'Priority',
  'Created At',
  'Updated At',
  'Notes',
];

// Initialize Google Sheets API client (if configured)
let sheetsClient: any = null;
if (GOOGLE_SHEETS_CREDENTIALS_PATH && GOOGLE_SHEETS_SPREADSHEET_ID) {
  try {
    const credentials = JSON.parse(fs.readFileSync(GOOGLE_SHEETS_CREDENTIALS_PATH, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('✓ Google Sheets client initialized');
  } catch (error) {
    console.error('Failed to initialize Google Sheets:', error);
  }
}

// Initialize SendGrid (if configured)
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log('✓ SendGrid client initialized');
}

/**
 * Create the unified MCP server with all tools
 */
function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'crm-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  const anyServer = server as any;

  // Set up tool handlers
  anyServer.setRequestHandler(ListToolsRequestSchema, async (request: any) => {
    console.log('[MCP] ListTools request headers:', request?.headers || request?.context?.req?.headers);
    return { tools: getAllTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request:any) => {
    console.log('[MCP] CallTool method:', request?.method, 'params:', request?.params);
    const name  = request.params?.name;
    const args: any = request.params?.arguments ?? {};
    // try to locate underlying HTTP response (SDK shapes vary)
    const ctx = request.context || request.locals || {};
    const res = ctx.res || ctx.response || request.res || request.response;

    // initialize — ensure Mcp-Session-Id header is set and exposed
    if (name === 'initialize' || name === 'initialize_session') {
      const sessionId = (globalThis as any).crypto?.randomUUID?.() ?? Date.now().toString();
      setSessionHeaders(res, sessionId);
      return {
        headers: { 'Access-Control-Expose-Headers': 'Mcp-Session-Id' },
        content: [{ type: 'text', text: 'Initialized' }],
        sessionId,
      };
    }
    try {
      // Route to appropriate tool handler
      if (name.startsWith('sheets_') || ['initialize_sheet', 'add_customer_record', 'get_customer_record', 'update_customer_record', 'search_customer_records', 'list_all_customers', 'check_customer_history', 'get_service_pricing'].includes(name)) {
        return await handleSheetsTool(name, args);
      } else if (name.startsWith('calendly_') || ['list_event_types', 'get_event_type', 'get_scheduling_link', 'list_scheduled_events', 'get_event_invitee', 'cancel_event','create_event','event_type_available_times','create_appointment','check_availability','book_appointment'].includes(name)) {
        return await handleCalendlyTool(name, args);
      } else if (name.startsWith('email_') || ['send_appointment_confirmation', 'send_appointment_reminder', 'send_custom_email'].includes(name)) {
        return await handleEmailTool(name, args);
      } else {
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

  // Error handling
  server.onerror = (error) => console.error('[MCP Error]', error);

  return server;
}

/**
 * Get all available tools
 */
function getAllTools(): Tool[] {
  const tools: Tool[] = [];

  // Google Sheets tools
  if (sheetsClient && GOOGLE_SHEETS_SPREADSHEET_ID) {
    tools.push(
      {
        name: 'initialize_sheet',
        description: 'Initialize the Google Sheet with proper headers. Run this once when setting up a new sheet.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'add_customer_record',
        description: 'Add a new customer support record to the Google Sheet',
        inputSchema: {
          type: 'object',
          properties: {
            make: { type: 'string', description: 'Vehicle make (e.g., Toyota)' },
            model: { type: 'string', description: 'Vehicle model (e.g., Corolla)' },
            km: { type: 'string', description: 'Vehicle kilometers (e.g., 12345)' },
            name: { type: 'string', description: 'Customer name' },
            email: { type: 'string', description: 'Customer email address' },
            phone: { type: 'string', description: 'Customer phone number (optional)' },
            issue: { type: 'string', description: 'Description of the customer issue or request' },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'resolved', 'closed'],
              description: 'Current status of the ticket',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level of the issue',
            },
            notes: { type: 'string', description: 'Additional notes (optional)' },
          },
          required: ['name', 'email', 'issue', 'status', 'priority'],
        },
      },
      {
        name: 'get_customer_record',
        description: 'YOU MUST CALL THIS IMMEDIATELY when you hear a phone number. Do not respond to the customer until you call this and get the result. This returns their name and vehicle so you can greet them properly.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The customer record ID' },
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
            id: { type: 'string', description: 'The customer record ID to update' },
            name: { type: 'string', description: 'Customer name' },
            email: { type: 'string', description: 'Customer email address' },
            phone: { type: 'string', description: 'Customer phone number' },
            issue: { type: 'string', description: 'Description of the issue' },
            status: {
              type: 'string',
              enum: ['open', 'in-progress', 'resolved', 'closed'],
              description: 'Current status',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
              description: 'Priority level',
            },
            notes: { type: 'string', description: 'Additional notes' },
          },
          required: ['id'],
        },
      },
      {
        name: 'search_customer_records',
        description: 'Search for customer records by email, name, status, or priority',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Search by email address' },
            name: { type: 'string', description: 'Search by customer name' },
            status: { type: 'string', description: 'Filter by status' },
            priority: { type: 'string', description: 'Filter by priority' },
          },
        },
      },
      {
        name: 'list_all_customers',
        description: 'List all customer records in the sheet',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'check_customer_history',
        description: 'Check customer history by phone number',
        inputSchema: {
          type: 'object',
          properties: {
            phone_number: { type: 'string', description: 'Customer phone number' },
          },
          required: ['phone_number'],
        },
      },
      {
        name: 'get_service_pricing',
        description: "YOU MUST CALL THIS before quoting ANY price. Never say a price without calling this first. Customer is waiting for an accurate quote.",
        inputSchema: {
          type: 'object',
          properties: {
            service_type: {
              type: 'string',
              description: 'Type of service (e.g., oil change, full service, brake service, tire rotation, engine diagnostic, transmission service, ac service, battery replacement)',
            },
            vehicle_type: {
              type: 'string',
              description: 'Type of vehicle (e.g., sedan, suv, truck)',
            },
          },
          required: ['service_type', 'vehicle_type'],
        },
      }
    );
  }

  // Calendly tools
  if (CALENDLY_API_TOKEN && CALENDLY_ORGANIZATION_URI) {
    tools.push(
      {
      name: 'create_event',
      description: 'Create appointment booking workflow with scheduling link',
      inputSchema: {
        type: 'object',
        properties: {
          eventTypeUri: { type: 'string', description: 'Event type URI' },
          customerName: { type: 'string', description: 'Customer name' },
          customerEmail: { type: 'string', description: 'Customer email' },
          customerPhone: { type: 'string', description: 'Phone number (optional)' },
          preferredDate: { type: 'string', description: 'ISO date (optional)' },
          notes: { type: 'string', description: 'Booking notes (optional)' },
        },
        required: ['eventTypeUri', 'customerName', 'customerEmail'],
      },
    },
      {
        name: 'list_event_types',
        description: 'List all available Calendly event types (appointment types)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_event_type',
        description: 'Get detailed information about a specific event type',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The Calendly event type URI',
            },
          },
          required: ['eventTypeUri'],
        },
      },
      {
        name: 'get_scheduling_link',
        description: 'Get a scheduling link for a specific event type that can be shared with customers',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The Calendly event type URI',
            },
          },
          required: ['eventTypeUri'],
        },
      },
      {
        name: 'event_type_available_times',
        description: 'Return available time slots for the given event type for the week containing the reference date (or this week).',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: { type: 'string', description: 'The Calendly event type URI' },
            referenceDate: { type: 'string', description: 'ISO date used to determine the week (optional). Defaults to today.' },
          },
          required: ['eventTypeUri'],
        },
      },
      {
        name: 'list_scheduled_events',
        description: 'List scheduled events, optionally filtered by status or date range',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['active', 'canceled'],
              description: 'Filter events by status',
            },
            minStartTime: {
              type: 'string',
              description: 'Minimum start time (ISO 8601 format)',
            },
            maxStartTime: {
              type: 'string',
              description: 'Maximum start time (ISO 8601 format)',
            },
          },
        },
      },
      {
        name: 'get_event_invitee',
        description: 'Get information about an event invitee',
        inputSchema: {
          type: 'object',
          properties: {
            inviteeUri: {
              type: 'string',
              description: 'The Calendly invitee URI',
            },
          },
          required: ['inviteeUri'],
        },
      },
      {
        name: 'cancel_event',
        description: 'Cancel a scheduled event',
        inputSchema: {
          type: 'object',
          properties: {
            eventUri: {
              type: 'string',
              description: 'The Calendly event URI',
            },
            reason: {
              type: 'string',
              description: 'Reason for cancellation (optional)',
            },
          },
          required: ['eventUri'],
        },
      },
      {
        name: 'check_availability',
        description: 'YOU MUST CALL THIS before suggesting appointment times. Do not make up time slots. Customer needs real availability.',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The URI of the event type to check availability for',
            },
            startTime: {
              type: 'string',
              description: 'Start time for availability search (ISO 8601 format, e.g., 2024-01-15T00:00:00Z)',
            },
            endTime: {
              type: 'string',
              description: 'End time for availability search (ISO 8601 format, e.g., 2024-01-22T23:59:59Z)',
            },
          },
          required: ['eventTypeUri', 'startTime', 'endTime'],
        },
      },
      {
        name: 'book_appointment',
        description: 'Generate a pre-filled scheduling link for booking an appointment with customer information',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The URI of the event type to book',
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
              description: 'Customer phone number (optional)',
            },
          },
          required: ['eventTypeUri', 'name', 'email'],
        },
      },
      {
        name: 'create_appointment',
        description: 'Create an appointment booking for a customer with scheduling link and optional preferred date/time',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: { type: 'string', description: 'Event type URI (use list_event_types to find available types)' },
            customerName: { type: 'string', description: 'Customer name' },
            customerEmail: { type: 'string', description: 'Customer email' },
            customerPhone: { type: 'string', description: 'Phone number (optional)' },
            preferredDate: { type: 'string', description: 'Preferred ISO datetime (optional, e.g. 2025-12-15T10:00:00Z)' },
            notes: { type: 'string', description: 'Booking notes (optional)' },
          },
          required: ['eventTypeUri', 'customerName', 'customerEmail'],
        },
      }
    );
  }

  // Email tools
  if (SENDGRID_API_KEY && SENDGRID_FROM_EMAIL) {
    tools.push(
      {
        name: 'send_appointment_confirmation',
        description: 'Send an appointment confirmation email to a customer',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            customerName: { type: 'string', description: 'Customer name' },
            appointmentDate: { type: 'string', description: 'Date of appointment' },
            appointmentTime: { type: 'string', description: 'Time of appointment' },
            schedulingLink: { type: 'string', description: 'Link to manage appointment' },
          },
          required: ['to', 'customerName', 'appointmentDate', 'appointmentTime'],
        },
      },
      {
        name: 'send_appointment_reminder',
        description: 'Send an appointment reminder email',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            customerName: { type: 'string', description: 'Customer name' },
            appointmentDate: { type: 'string', description: 'Date of appointment' },
            appointmentTime: { type: 'string', description: 'Time of appointment' },
            schedulingLink: { type: 'string', description: 'Link to manage appointment' },
          },
          required: ['to', 'customerName', 'appointmentDate', 'appointmentTime'],
        },
      },
      {
        name: 'send_custom_email',
        description: 'Send a custom email to a recipient',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            text: { type: 'string', description: 'Plain text content' },
            html: { type: 'string', description: 'HTML content (optional)' },
          },
          required: ['to', 'subject', 'text'],
        },
      }
    );
  }

  return tools;
}

// =============================================================================
// Google Sheets Tool Handlers
// =============================================================================

async function handleSheetsTool(toolName: string, args: any): Promise<any> {
  console.log(`[handleSheetsTool] Tool: ${toolName}, Args: ${JSON.stringify(args)}`);
  if (!sheetsClient || !GOOGLE_SHEETS_SPREADSHEET_ID) {
    console.error(`[handleSheetsTool] Google Sheets is not configured. sheetsClient=${!!sheetsClient}, spreadsheetId=${!!GOOGLE_SHEETS_SPREADSHEET_ID}`);
    throw new Error('Google Sheets is not configured');
  }

  switch (toolName) {
    case 'initialize_sheet':
      return await initializeSheet();
    case 'add_customer_record':
      return await addCustomerRecord(args);
    case 'get_customer_record':
      return await getCustomerRecord(args.id);
    case 'update_customer_record':
      return await updateCustomerRecord(args);
    case 'search_customer_records':
      return await searchCustomerRecords(args);
    case 'list_all_customers':
      return await listAllCustomers();
    case 'check_customer_history':
      return await checkCustomerHistory(args.phone_number);
    case 'get_service_pricing':
      return await getServicePricing(args.service_type, args.vehicle_type);
    default:
      throw new Error(`Unknown Google Sheets tool: ${toolName}`);
  }
}

// helper to convert 1-based column index to letter (1 -> A, 27 -> AA)
function columnLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function initializeSheet(): Promise<any> {
  const endCol = columnLetter(HEADERS.length);
  const range = `${SHEET_NAME}!A1:${endCol}1`;
  const result = await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS],
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: `Sheet initialized successfully with headers: ${HEADERS.join(', ')}`,
      },
    ],
  };
}

async function addCustomerRecord(record: CustomerRecord): Promise<any> {
  console.log(`[addCustomerRecord] Adding record for: ${record.name}, email: ${record.email}, phone: ${record.phone || 'N/A'}`);
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  // Row layout matches HEADERS:
  // [ ID, Make, Model, KM, Name, Email, Phone, Issue, Status, Priority, Created At, Updated At, Notes ]
  const row = [
    id,
    record.make || '',
    record.model || '',
    record.km || '',
    record.name,
    record.email,
    record.phone || '',
    record.issue,
    record.status,
    record.priority,
    timestamp,
    timestamp,
    record.notes || '',
  ];

  const endCol = columnLetter(HEADERS.length);
  await sheetsClient.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:${endCol}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [row],
    },
  });

  return {
    content: [
      {
        type: 'text',
        text: `Customer record created successfully with ID: ${id}`,
      },
    ],
  };
}

async function getCustomerRecord(id: string): Promise<any> {
  console.log(`[getCustomerRecord] Looking up ID: ${id}`);
  const endCol = columnLetter(HEADERS.length);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:${endCol}`,
  });

  const rows = result.data.values || [];
  const recordRow = rows.find((row: any[]) => row[0] === id);

  if (!recordRow) {
    console.log(`[getCustomerRecord] No record found for ID: ${id}`);
    return {
      content: [
        {
          type: 'text',
          text: `No customer record found with ID: ${id}`,
        },
      ],
    };
  }

  // HEADERS: ID(0), Make(1), Model(2), KM(3), Name(4), Email(5), Phone(6), Issue(7), Status(8), Priority(9), Created At(10), Updated At(11), Notes(12)
  const record = {
    id: recordRow[0],
    make: recordRow[1],
    model: recordRow[2],
    km: recordRow[3],
    name: recordRow[4],
    email: recordRow[5],
    phone: recordRow[6],
    issue: recordRow[7],
    status: recordRow[8],
    priority: recordRow[9],
    createdAt: recordRow[10],
    updatedAt: recordRow[11],
    notes: recordRow[12],
  };

  console.log(`[getCustomerRecord] Found record for: ${record.name}`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(record, null, 2),
      },
    ],
  };
}

async function updateCustomerRecord(update: any): Promise<any> {
  console.log(`[updateCustomerRecord] Updating ID: ${update.id}`);
  const endCol = columnLetter(HEADERS.length);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:${endCol}`,
  });

  const rows = result.data.values || [];
  const rowIndex = rows.findIndex((row: any[]) => row[0] === update.id);

  if (rowIndex === -1) {
    console.log(`[updateCustomerRecord] No record found for ID: ${update.id}`);
    return {
      content: [
        {
          type: 'text',
          text: `No customer record found with ID: ${update.id}`,
        },
      ],
    };
  }

  // HEADERS: ID(0), Make(1), Model(2), KM(3), Name(4), Email(5), Phone(6), Issue(7), Status(8), Priority(9), Created At(10), Updated At(11), Notes(12)
  const existingRow = rows[rowIndex];
  const updatedRow = [
    existingRow[0],  // ID remains the same
    update.make !== undefined ? update.make : existingRow[1],
    update.model !== undefined ? update.model : existingRow[2],
    update.km !== undefined ? update.km : existingRow[3],
    update.name !== undefined ? update.name : existingRow[4],
    update.email !== undefined ? update.email : existingRow[5],
    update.phone !== undefined ? update.phone : existingRow[6],
    update.issue !== undefined ? update.issue : existingRow[7],
    update.status !== undefined ? update.status : existingRow[8],
    update.priority !== undefined ? update.priority : existingRow[9],
    existingRow[10], // Created At remains the same
    new Date().toISOString(), // Updated At
    update.notes !== undefined ? update.notes : existingRow[12],
  ];

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex + 1}:${endCol}${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [updatedRow],
    },
  });

  console.log(`[updateCustomerRecord] Record ${update.id} updated successfully`);
  return {
    content: [
      {
        type: 'text',
        text: `Customer record ${update.id} updated successfully`,
      },
    ],
  };
}

async function searchCustomerRecords(criteria: any): Promise<any> {
  const endCol = columnLetter(HEADERS.length);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:${endCol}`,
  });

  const rows = result.data.values || [];
  const matchingRecords = rows.slice(1).filter((row: any[]) => {
    // HEADERS indexes (0-based):
    // 0: ID, 1: Make, 2: Model, 3: KM, 4: Name, 5: Email, 6: Phone, 7: Issue, 8: Status, 9: Priority, 10: Created At, 11: Updated At, 12: Notes
    if (criteria.email && row[5] !== criteria.email) return false; // Email at index 5
    if (criteria.name && !(row[4] || '').toLowerCase().includes(criteria.name.toLowerCase())) return false; // Name at index 4
    if (criteria.status && row[8] !== criteria.status) return false; // Status at index 8
    if (criteria.priority && row[9] !== criteria.priority) return false; // Priority at index 9
    return true;
  });

  const records = matchingRecords.map((row: any[]) => ({
    id: row[0],
    make: row[1],
    model: row[2],
    km: row[3],
    name: row[4],
    email: row[5],
    phone: row[6],
    issue: row[7],
    status: row[8],
    priority: row[9],
    createdAt: row[10],
    updatedAt: row[11],
    notes: row[12],
  }));

  return {
    content: [
      {
        type: 'text',
        text: `Found ${records.length} matching records:\n${JSON.stringify(records, null, 2)}`,
      },
    ],
  };
}

async function listAllCustomers(): Promise<any> {
  console.log('[listAllCustomers] Fetching all records');
  const endCol = columnLetter(HEADERS.length);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:${endCol}`,
  });

  const rows = result.data.values || [];
  // HEADERS: ID(0), Make(1), Model(2), KM(3), Name(4), Email(5), Phone(6), Issue(7), Status(8), Priority(9), Created At(10), Updated At(11), Notes(12)
  const records = rows.slice(1).map((row: any[]) => ({
    id: row[0],
    make: row[1],
    model: row[2],
    km: row[3],
    name: row[4],
    email: row[5],
    phone: row[6],
    issue: row[7],
    status: row[8],
    priority: row[9],
    createdAt: row[10],
    updatedAt: row[11],
    notes: row[12],
  }));

  console.log(`[listAllCustomers] Found ${records.length} records`);
  return {
    content: [
      {
        type: 'text',
        text: `Total records: ${records.length}\n${JSON.stringify(records, null, 2)}`,
      },
    ],
  };
}

async function checkCustomerHistory(phoneNumber: string): Promise<any> {
  console.log(`[checkCustomerHistory] Looking up phone: ${phoneNumber}`);
  const endCol = columnLetter(HEADERS.length);
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:${endCol}`,
  });

  const rows = result.data.values || [];
  console.log(`[checkCustomerHistory] Total rows in sheet: ${rows.length - 1}`);
  // HEADERS: ID(0), Make(1), Model(2), KM(3), Name(4), Email(5), Phone(6), Issue(7), Status(8), Priority(9), Created At(10), Updated At(11), Notes(12)
  const matchingRecords = rows.slice(1).filter((row: any[]) => row[6] === phoneNumber);
  console.log(`[checkCustomerHistory] Matching records for phone ${phoneNumber}: ${matchingRecords.length}`);

  const records = matchingRecords.map((row: any[]) => ({
    id: row[0],
    make: row[1],
    model: row[2],
    km: row[3],
    name: row[4],
    email: row[5],
    phone: row[6],
    issue: row[7],
    status: row[8],
    priority: row[9],
    createdAt: row[10],
    updatedAt: row[11],
    notes: row[12],
  }));

  return {
    content: [
      {
        type: 'text',
        text: `Found ${records.length} records for phone ${phoneNumber}:\n${JSON.stringify(records, null, 2)}`,
      },
    ],
  };
}

// =============================================================================
// Service Pricing
// =============================================================================

const SERVICE_PRICING: Record<string, Record<string, number>> = {
  'oil change':            { sedan: 49, suv: 59, truck: 69 },
  'full service':          { sedan: 199, suv: 249, truck: 299 },
  'brake service':         { sedan: 149, suv: 179, truck: 209 },
  'tire rotation':         { sedan: 39, suv: 49, truck: 55 },
  'engine diagnostic':     { sedan: 89, suv: 89, truck: 99 },
  'transmission service':  { sedan: 179, suv: 219, truck: 259 },
  'ac service':            { sedan: 129, suv: 149, truck: 159 },
  'battery replacement':   { sedan: 159, suv: 169, truck: 189 },
  'wheel alignment':       { sedan: 89, suv: 99, truck: 109 },
  'coolant flush':         { sedan: 99, suv: 119, truck: 139 },
};

async function getServicePricing(serviceType: string, vehicleType: string): Promise<any> {
  console.log(`[getServicePricing] service_type: "${serviceType}", vehicle_type: "${vehicleType}"`);
  const svcKey = (serviceType || '').toLowerCase().trim();
  const vehKey = (vehicleType || '').toLowerCase().trim();
  console.log(`[getServicePricing] Normalized keys — service: "${svcKey}", vehicle: "${vehKey}"`);
  console.log(`[getServicePricing] Available services: ${Object.keys(SERVICE_PRICING).join(', ')}`);

  const servicePrices = SERVICE_PRICING[svcKey];
  if (!servicePrices) {
    const availableServices = Object.keys(SERVICE_PRICING).join(', ');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Unknown service type: "${serviceType}"`,
          available_services: availableServices,
        }, null, 2),
      }],
    };
  }

  const price = servicePrices[vehKey];
  if (price === undefined) {
    const availableVehicles = Object.keys(servicePrices).join(', ');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: `Unknown vehicle type: "${vehicleType}"`,
          available_vehicle_types: availableVehicles,
        }, null, 2),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        service_type: serviceType,
        vehicle_type: vehicleType,
        price,
        currency: 'USD',
        formatted_price: `$${price}`,
      }, null, 2),
    }],
  };
}

// =============================================================================
// Calendly Tool Handlers
// =============================================================================

async function handleCalendlyTool(toolName: string, args: any): Promise<any> {
  if (!CALENDLY_API_TOKEN || !CALENDLY_ORGANIZATION_URI) {
    throw new Error('Calendly is not configured');
  }

  switch (toolName) {
    case 'list_event_types':
      return await listEventTypes();
    case 'get_event_type':
      return await getEventType(args.eventTypeUri);
    case 'get_scheduling_link':
      return await getSchedulingLink(args.eventTypeUri);
    case 'event_type_available_times':
      return await calendlyEventTypeAvailableTimes(args);
    case 'list_scheduled_events':
      return await listScheduledEvents(args);
    case 'get_event_invitee':
      return await getEventInvitee(args.inviteeUri);
    case 'cancel_event':
      return await cancelEvent(args.eventUri, args.reason);
    case 'check_availability':
      return await checkAvailability(args.eventTypeUri, args.startTime, args.endTime);
    case 'book_appointment':
      return await bookAppointment(args);
    case 'create_event':
    case 'create_appointment':
      return await createEvent(args);
    default:
      throw new Error(`Unknown Calendly tool: ${toolName}`);
  }
}

async function calendlyRequest(path: string, options: any = {}): Promise<any> {
  const fetch = (await import('node-fetch')).default;
  const response = await fetch(`https://api.calendly.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${CALENDLY_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Calendly API error: ${response.status} ${error}`);
  }

  return await response.json();
}

async function listEventTypes(): Promise<any> {
  const data = await calendlyRequest(`/event_types?organization=${encodeURIComponent(CALENDLY_ORGANIZATION_URI!)}`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data.collection, null, 2),
      },
    ],
  };
}

async function getEventType(eventTypeUri: string): Promise<any> {
  const data = await calendlyRequest(`/event_types/${eventTypeUri.split('/').pop()}`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data.resource, null, 2),
      },
    ],
  };
}

async function getSchedulingLink(eventTypeUri: string): Promise<any> {
  const data = await calendlyRequest(`/event_types/${eventTypeUri.split('/').pop()}`);
  const schedulingUrl = data.resource.scheduling_url;

  return {
    content: [
      {
        type: 'text',
        text: `Scheduling link: ${schedulingUrl}`,
      },
    ],
  };
}

async function listScheduledEvents(params: any): Promise<any> {
  let queryParams = `organization=${encodeURIComponent(CALENDLY_ORGANIZATION_URI!)}`;
  if (params.status) {
    queryParams += `&status=${encodeURIComponent(params.status)}`;
  }
  if (params.minStartTime) {
    queryParams += `&min_start_time=${encodeURIComponent(params.minStartTime)}`;
  }
  if (params.maxStartTime) {
    queryParams += `&max_start_time=${encodeURIComponent(params.maxStartTime)}`;
  }

  const data = await calendlyRequest(`/scheduled_events?${queryParams}`);

  const events = data.collection.map((event: any) => ({
    uri: event.uri,
    name: event.name,
    status: event.status,
    start_time: event.start_time,
    end_time: event.end_time,
    event_type: event.event_type,
    location: event.location,
    invitees_counter: event.invitees_counter,
  }));

  return {
    content: [
      {
        type: 'text',
        text: `Found ${events.length} scheduled events:\n${JSON.stringify(events, null, 2)}`,
      },
    ],
  };
}

async function getEventInvitee(inviteeUri: string): Promise<any> {
  const data = await calendlyRequest(`/scheduled_events/${inviteeUri.split('/').pop()}/invitees`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function cancelEvent(eventUri: string, reason?: string): Promise<any> {
  await calendlyRequest(`/scheduled_events/${eventUri.split('/').pop()}/cancellation`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'Cancelled by admin' }),
  });

  return {
    content: [
      {
        type: 'text',
        text: `Event ${eventUri} cancelled successfully`,
      },
    ],
  };
}

async function checkAvailability(eventTypeUri: string, startTime: string, endTime: string): Promise<any> {
  const endpoint = `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;

  const data = await calendlyRequest(endpoint);

  if (!data.collection || data.collection.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No available time slots found between ${startTime} and ${endTime}`,
        },
      ],
    };
  }

  const availableSlots = data.collection.map((slot: any) => ({
    start_time: slot.start_time,
    status: slot.status,
    invitees_remaining: slot.invitees_remaining,
  }));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            event_type: eventTypeUri,
            search_period: {
              start: startTime,
              end: endTime,
            },
            total_slots: availableSlots.length,
            available_times: availableSlots,
          },
          null,
          2
        ),
      },
    ],
  };
}

async function bookAppointment(details: { eventTypeUri: string; name: string; email: string; phone?: string }): Promise<any> {
  // Get the event type details to fetch the scheduling URL
  const eventTypeData = await calendlyRequest(`/event_types/${details.eventTypeUri.split('/').pop()}`);

  const schedulingUrl = eventTypeData.resource.scheduling_url;

  // Build pre-filled URL with customer information
  const params = new URLSearchParams();
  params.append('name', details.name);
  params.append('email', details.email);
  if (details.phone) {
    params.append('a1', details.phone); // a1 is typically used for phone number in Calendly
  }

  const prefilledUrl = `${schedulingUrl}?${params.toString()}`;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            message: 'Booking link generated successfully',
            event_name: eventTypeData.resource.name,
            customer: {
              name: details.name,
              email: details.email,
              phone: details.phone || 'Not provided',
            },
            scheduling_url: prefilledUrl,
            instructions: 'Share this pre-filled link with the customer to complete their booking. The customer will be able to select their preferred time slot.',
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * Return available times for an event type for the week containing referenceDate (or this week).
 * Args: { eventTypeUri: string, referenceDate?: string }
 */
async function calendlyEventTypeAvailableTimes(args: { eventTypeUri: string; referenceDate?: string; }): Promise<any> {
  const { eventTypeUri, referenceDate } = args || {};
  if (!eventTypeUri) throw new Error('eventTypeUri is required');

  // compute week start (Monday) and end (Sunday) in ISO 8601
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  if (Number.isNaN(ref.getTime())) throw new Error('referenceDate is not a valid date');

  // get Monday of the week (ISO week starting Monday)
  const day = ref.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = ((day + 6) % 7); // 0 -> Monday, 6 -> Sunday
  const monday = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  // Sunday end of day
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  const startTime = monday.toISOString();
  const endTime = sunday.toISOString();

  // Call Calendly API for available times in the week
  const params = new URLSearchParams();
  params.append('event_type', eventTypeUri);
  params.append('start_time', startTime);
  params.append('end_time', endTime);

  const path = `/event_type_available_times?${params.toString()}`;
  const data = await calendlyRequest(path);

  // data.collection is expected to be an array of available slot objects
  const slots = Array.isArray(data?.collection) ? data.collection : [];

  // Group slots by date (YYYY-MM-DD) for the week
  const availabilityByDay: Record<string, any[]> = {};
  for (let d = new Date(monday); d <= sunday; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    availabilityByDay[key] = [];
  }

  slots.forEach((slot: any) => {
    const start = slot.start_time || slot.starts_at || slot.start;
    if (!start) return;
    const dateKey = (new Date(start)).toISOString().slice(0, 10);
    if (!availabilityByDay[dateKey]) availabilityByDay[dateKey] = [];
    availabilityByDay[dateKey].push({
      start_time: slot.start_time ?? slot.starts_at ?? slot.start,
      end_time: slot.end_time ?? slot.ends_at ?? slot.end,
      status: slot.status,
      invitees_remaining: slot.invitees_remaining,
      // include original slot object for detail
      raw: slot,
    });
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          eventTypeUri,
          weekStart: startTime,
          weekEnd: endTime,
          availabilityByDay,
        }, null, 2),
      },
    ],
  };
}

//

async function createEvent(details: {
  eventTypeUri: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  preferredDate?: string; // "2025-12-15T10:00:00Z"
  notes?: string;
}): Promise<any> {
  try {
    const eventTypeId = details.eventTypeUri.split('/').pop();
    const eventTypeData = await calendlyRequest(`/event_types/${eventTypeId}`);
    const eventType = eventTypeData.resource;

    // Step 1: Create single-use scheduling link
    const linkPayload: any = {
      max_event_count: 1,
      owner: details.eventTypeUri,
      owner_type: 'EventType',
    };

    // **NEW: Add date constraints if preferredDate provided**
    if (details.preferredDate) {
      const preferredDateTime = new Date(details.preferredDate);
      
      // Set date_setting to constrain to specific date
      linkPayload.date_setting = {
        type: 'date_range',
        start_date: preferredDateTime.toISOString().split('T')[0], // "2025-12-15"
        end_date: preferredDateTime.toISOString().split('T')[0],   // Same day
      };
    }

    const linkResponse = await calendlyRequest('/scheduling_links', {
      method: 'POST',
      body: JSON.stringify(linkPayload),
    });

    const schedulingUrl = linkResponse.resource.booking_url;

    // Step 2: Build pre-filled URL with customer information
    const params = new URLSearchParams();
    params.append('name', details.customerName);
    params.append('email', details.customerEmail);

    if (details.customerPhone) {
      params.append('a1', details.customerPhone);
    }

    if (details.notes) {
      params.append('a2', details.notes);
    }

    // **NEW: Add date/time to URL if provided**
    if (details.preferredDate) {
      const preferredDateTime = new Date(details.preferredDate);
      // Format: YYYY-MM-DD
      params.append('date', preferredDateTime.toISOString().split('T')[0]);
      // Format: HH:MM (24-hour)
      const hours = preferredDateTime.getUTCHours().toString().padStart(2, '0');
      const minutes = preferredDateTime.getUTCMinutes().toString().padStart(2, '0');
      params.append('time', `${hours}:${minutes}`);
    }

    const prefilledUrl = `${schedulingUrl}?${params.toString()}`;

    // Step 3: Check availability if date provided
    let availabilityInfo = null;
    if (details.preferredDate) {
      try {
        const date = new Date(details.preferredDate);
        const startTime = new Date(date.setHours(0, 0, 0, 0)).toISOString();
        const endTime = new Date(date.setHours(23, 59, 59, 999)).toISOString();

        const availabilityParams = new URLSearchParams();
        availabilityParams.append('event_type', details.eventTypeUri);
        availabilityParams.append('start_time', startTime);
        availabilityParams.append('end_time', endTime);

        const availabilityData = await calendlyRequest(
          `/event_type_available_times?${availabilityParams.toString()}`
        );

        if (availabilityData.collection && availabilityData.collection.length > 0) {
          // Check if the exact time slot is available
          const exactSlot = availabilityData.collection.find((slot: any) => {
            const slotStart = new Date(slot.start_time || slot.starts_at);
            return slotStart.getTime() === new Date(details.preferredDate!).getTime();
          });

          availabilityInfo = {
            requested_time: details.preferredDate,
            exact_slot_available: !!exactSlot,
            total_slots_on_date: availabilityData.collection.length,
            nearest_slots: availabilityData.collection.slice(0, 3).map((slot: any) => ({
              start_time: slot.start_time || slot.starts_at,
              status: slot.status,
              invitees_remaining: slot.invitees_remaining,
            })),
          };
        } else {
          availabilityInfo = {
            requested_time: details.preferredDate,
            exact_slot_available: false,
            total_slots_on_date: 0,
            message: 'No availability on requested date',
          };
        }
      } catch (error) {
        console.error('Could not fetch availability:', error);
        availabilityInfo = {
          requested_time: details.preferredDate,
          error: 'Could not check availability',
        };
      }
    }

    // Step 4: Build comprehensive response
    const response: any = {
      success: true,
      message: details.preferredDate 
        ? 'Scheduling link created with preferred date/time pre-selected'
        : 'Scheduling link generated - customer can select any available time',
      booking_url: prefilledUrl,
      booking_url_short: schedulingUrl,
      expires_after: '1 booking',
      owner_uri: linkResponse.resource.owner,
      created_at: linkResponse.resource.created_at,
      event_details: {
        name: eventType.name,
        duration: `${eventType.duration} minutes`,
        description: eventType.description_plain || 'No description',
        type: eventType.type,
        scheduling_url: eventType.scheduling_url,
      },
      customer: {
        name: details.customerName,
        email: details.customerEmail,
        phone: details.customerPhone || 'Not provided',
        notes: details.notes || 'None',
      },
    };

    // Add preferred date info if provided
    if (details.preferredDate) {
      response.preferred_datetime = {
        requested: details.preferredDate,
        date: new Date(details.preferredDate).toISOString().split('T')[0],
        time: new Date(details.preferredDate).toISOString().split('T')[1].substring(0, 5),
        timezone: 'UTC',
      };
      response.link_constraints = {
        type: 'date_range',
        limited_to_date: new Date(details.preferredDate).toISOString().split('T')[0],
      };
    }

    // Add availability check results
    if (availabilityInfo) {
      response.availability = availabilityInfo;
    }

    response.workflow = details.preferredDate ? {
      current_step: 'Link generated with pre-selected date/time',
      status: 'Awaiting customer confirmation',
      next_steps: [
        '1. Send booking link to customer',
        '2. Customer reviews pre-selected date/time',
        '3. Customer confirms or selects alternative time',
        '4. Booking confirmed automatically',
        '5. Both parties receive confirmation',
      ],
      note: availabilityInfo?.exact_slot_available 
        ? 'Requested time slot is available'
        : 'Requested time may not be available - customer will see available alternatives',
    } : {
      current_step: 'Link generated',
      status: 'Awaiting customer to select time',
      next_steps: [
        '1. Send booking link to customer',
        '2. Customer selects preferred time',
        '3. Customer confirms booking',
        '4. Both parties receive confirmation',
      ],
    };

    response.email_template = details.preferredDate
      ? `Hi ${details.customerName},\n\nThank you for choosing our service! We've prepared a booking link with your preferred date and time pre-selected:\n\nDate: ${new Date(details.preferredDate).toLocaleDateString()}\nTime: ${new Date(details.preferredDate).toLocaleTimeString()}\n\nBook here: ${prefilledUrl}\n\n${availabilityInfo?.exact_slot_available ? 'Your preferred time is available!' : 'Please review and select from available times if your preferred slot is not available.'}\n\nBest regards,\nThe Team`
      : `Hi ${details.customerName},\n\nThank you for choosing our service! Please use the link below to schedule your appointment:\n\n${prefilledUrl}\n\nYou can select a time that works best for you from the available slots.\n\nBest regards,\nThe Team`;

    response.sms_template = details.preferredDate
      ? `Hi ${details.customerName}, your appointment link (${new Date(details.preferredDate).toLocaleDateString()} ${new Date(details.preferredDate).toLocaleTimeString()}): ${prefilledUrl}`
      : `Hi ${details.customerName}, schedule your appointment here: ${prefilledUrl}`;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create event: ${errorMessage}`);
  }
}

// =============================================================================
// Email Tool Handlers
// =============================================================================

async function handleEmailTool(toolName: string, args: any): Promise<any> {
  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    throw new Error('SendGrid is not configured');
  }

  switch (toolName) {
    case 'send_appointment_confirmation':
      return await sendAppointmentConfirmation(args);
    case 'send_appointment_reminder':
      return await sendAppointmentReminder(args);
    case 'send_custom_email':
      return await sendCustomEmail(args);
    default:
      throw new Error(`Unknown email tool: ${toolName}`);
  }
}

async function sendAppointmentConfirmation(params: any): Promise<any> {
  const msg = {
    to: params.to,
    from: { email: SENDGRID_FROM_EMAIL!, name: SENDGRID_FROM_NAME },
    subject: 'Appointment Confirmation',
    text: `Hello ${params.customerName},\n\nYour appointment has been confirmed for ${params.appointmentDate} at ${params.appointmentTime}.\n\n${params.schedulingLink ? `Manage your appointment: ${params.schedulingLink}\n\n` : ''}Thank you!`,
    html: `<p>Hello ${params.customerName},</p><p>Your appointment has been confirmed for <strong>${params.appointmentDate}</strong> at <strong>${params.appointmentTime}</strong>.</p>${params.schedulingLink ? `<p><a href="${params.schedulingLink}">Manage your appointment</a></p>` : ''}<p>Thank you!</p>`,
  };

  await sgMail.send(msg);

  return {
    content: [
      {
        type: 'text',
        text: `Appointment confirmation email sent to ${params.to}`,
      },
    ],
  };
}

async function sendAppointmentReminder(params: any): Promise<any> {
  const msg = {
    to: params.to,
    from: { email: SENDGRID_FROM_EMAIL!, name: SENDGRID_FROM_NAME },
    subject: 'Appointment Reminder',
    text: `Hello ${params.customerName},\n\nThis is a reminder that you have an appointment scheduled for ${params.appointmentDate} at ${params.appointmentTime}.\n\n${params.schedulingLink ? `Manage your appointment: ${params.schedulingLink}\n\n` : ''}See you soon!`,
    html: `<p>Hello ${params.customerName},</p><p>This is a reminder that you have an appointment scheduled for <strong>${params.appointmentDate}</strong> at <strong>${params.appointmentTime}</strong>.</p>${params.schedulingLink ? `<p><a href="${params.schedulingLink}">Manage your appointment</a></p>` : ''}<p>See you soon!</p>`,
  };

  await sgMail.send(msg);

  return {
    content: [
      {
        type: 'text',
        text: `Appointment reminder email sent to ${params.to}`,
      },
    ],
  };
}

async function sendCustomEmail(params: any): Promise<any> {
  const msg = {
    to: params.to,
    from: { email: SENDGRID_FROM_EMAIL!, name: SENDGRID_FROM_NAME },
    subject: params.subject,
    text: params.text,
    html: params.html || params.text,
  };

  await sgMail.send(msg);

  return {
    content: [
      {
        type: 'text',
        text: `Email sent to ${params.to}`,
      },
    ],
  };
}

// =============================================================================
// Express Server Setup
// =============================================================================

const app = express();
app.use(express.json());

// CORS configuration - allow OpenAI and other domains
app.use(cors({
  origin: '*',
  credentials: true,
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Accept', 'Origin'],
}));




// Create a single MCP server instance at startup
const mcpServer = createMCPServer();

// Simple map to track active transports by session ID
// The SDK manages session lifecycle via callbacks
const activeTransports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Validate Origin header to prevent DNS rebinding attacks
 * Per MCP spec: Servers should validate the Origin header
 */
function validateOrigin(req: express.Request): boolean {
  const origin = req.headers.origin;
  // For localhost servers, allow localhost and 127.0.0.1
  // In production, you should validate against your allowed domains
  if (!origin) return true; // No origin header is acceptable for same-origin requests

  try {
    const originUrl = new URL(origin);
    const allowedHosts = ['localhost', '127.0.0.1', 'openai.com','ngrok-free.app', 'ngrok.app','api.openai.com','loca.lt'];
    return allowedHosts.some(host => originUrl.hostname === host || originUrl.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    configured: {
      googleSheets: !!(GOOGLE_SHEETS_CREDENTIALS_PATH && GOOGLE_SHEETS_SPREADSHEET_ID),
      calendly: !!(CALENDLY_API_TOKEN && CALENDLY_ORGANIZATION_URI),
      sendgrid: !!(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL),
    },
  });
});

// =============================================================================
// Direct Function Execution Endpoints (no MCP protocol)
// Used by support_agent WebSocket sideband handler to call CRM tools directly.
// =============================================================================

/**
 * GET /tools — return all tool definitions as plain JSON (OpenAI function format).
 */
app.get('/tools', (req, res) => {
  res.json({ tools: getAllTools() });
});

/**
 * POST /execute — execute a CRM tool function directly, bypassing MCP protocol.
 *
 * Request body: { "name": "<tool_name>", "arguments": { ... } }
 * Response:     { "result": "<text output>" }  on success
 *               { "error":  "<message>" }       on failure (HTTP 400/500)
 */
app.post('/execute', async (req, res) => {
  const { name, arguments: args } = req.body || {};

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Request body must include "name" (string)' });
    return;
  }

  console.log(`[/execute] tool=${name} args=${JSON.stringify(args).slice(0, 200)}`);

  const sheetsTools = [
    'initialize_sheet', 'add_customer_record', 'get_customer_record',
    'update_customer_record', 'search_customer_records', 'list_all_customers',
    'check_customer_history', 'get_service_pricing',
  ];
  const calendlyTools = [
    'list_event_types', 'get_event_type', 'get_scheduling_link',
    'list_scheduled_events', 'get_event_invitee', 'cancel_event',
    'create_event', 'event_type_available_times', 'create_appointment',
    'check_availability', 'book_appointment',
  ];
  const emailTools = [
    'send_appointment_confirmation', 'send_appointment_reminder', 'send_custom_email',
  ];

  try {
    let toolResult: any;

    if (name.startsWith('sheets_') || sheetsTools.includes(name)) {
      toolResult = await handleSheetsTool(name, args || {});
    } else if (name.startsWith('calendly_') || calendlyTools.includes(name)) {
      toolResult = await handleCalendlyTool(name, args || {});
    } else if (name.startsWith('email_') || emailTools.includes(name)) {
      toolResult = await handleEmailTool(name, args || {});
    } else {
      res.status(400).json({ error: `Unknown tool: ${name}` });
      return;
    }

    // Unwrap MCP-style { content: [{ type, text }] } → plain string
    const content: any[] = toolResult?.content ?? [];
    const resultText: string = content.length > 0
      ? content[0].text ?? JSON.stringify(toolResult)
      : JSON.stringify(toolResult);

    console.log(`[/execute] tool=${name} OK — result length=${resultText.length}`);
    res.json({ result: resultText });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[/execute] tool=${name} ERROR — ${msg}`);
    res.status(500).json({ error: msg });
  }
});

// 🆕 ADD THIS - Root endpoint for MCP discovery
app.get('/', (req, res) => {
  res.json({
    name: 'CRM MCP Server',
    version: '1.0.0',
    mcp_endpoint: '/mcp',
    transport: 'Streamable HTTP',
    protocol: 'MCP 2024-11-05',
    status: 'ready',
    tools_count: getAllTools().length,
    instructions: 'POST to /mcp with JSON-RPC messages. Use Mcp-Session-Id header for subsequent requests.',
  });
});


// Add detailed request logging
app.use('/mcp', (req, res, next) => {
  console.log('\n========================================');
  console.log('🔍 MCP Request Debug');
  console.log('========================================');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  const incomingSession = req.header('Mcp-Session-Id') || req.header('mcp-session-id') || '';
  console.log('Session ID from header:', incomingSession);
    console.log('Active sessions:', Array.from(activeTransports.keys()));
    console.log('========================================\n');
    next();
});

// ---------------------------------------------------------------------------
// Early intercept for tools/call and tools/list — handle directly at Express
// level so that clients that skip the MCP initialize handshake still get a
// proper JSON response instead of "Server not initialized" from the SDK
// transport.  This middleware runs BEFORE the main app.all('/mcp') handler.
// ---------------------------------------------------------------------------
app.post('/mcp', async (req, res, next) => {
  try {
    const method = req.body?.method;

    // tools/list — return tool catalogue immediately
    if (method === 'tools/list') {
      const rpcId = req.body.id ?? null;
      console.log('[MCP middleware] tools/list — returning tools directly');
      res.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: { tools: getAllTools() },
      });
      return;
    }

    // tools/call — execute the tool directly and return plain JSON
    if (method === 'tools/call') {
      const rpcId = req.body.id ?? null;
      const toolName: string = req.body.params?.name;
      const toolArgs: any = req.body.params?.arguments ?? {};
      console.log(`[MCP middleware] tools/call — tool: ${toolName}, args: ${JSON.stringify(toolArgs)}`);

      try {
        let toolResult: any;

        if (toolName.startsWith('sheets_') || ['initialize_sheet', 'add_customer_record', 'get_customer_record', 'update_customer_record', 'search_customer_records', 'list_all_customers', 'check_customer_history', 'get_service_pricing'].includes(toolName)) {
          toolResult = await handleSheetsTool(toolName, toolArgs);
        } else if (toolName.startsWith('calendly_') || ['list_event_types', 'get_event_type', 'get_scheduling_link', 'list_scheduled_events', 'get_event_invitee', 'cancel_event', 'create_event', 'event_type_available_times', 'create_appointment', 'check_availability', 'book_appointment'].includes(toolName)) {
          toolResult = await handleCalendlyTool(toolName, toolArgs);
        } else if (toolName.startsWith('email_') || ['send_appointment_confirmation', 'send_appointment_reminder', 'send_custom_email'].includes(toolName)) {
          toolResult = await handleEmailTool(toolName, toolArgs);
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        console.log(`[MCP middleware] tools/call SUCCESS — tool: ${toolName}`);
        res.json({ jsonrpc: '2.0', id: rpcId, result: toolResult });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[MCP middleware] tools/call ERROR — tool: ${toolName}, error: ${errorMessage}`);
        res.json({
          jsonrpc: '2.0',
          id: rpcId,
          result: { content: [{ type: 'text', text: `Error: ${errorMessage}` }] },
        });
      }
      return;
    }

    // Not tools/list or tools/call — pass to main handler
    next();
  } catch (err) {
    next(err);
  }
});
/**
 * MCP endpoint - Single endpoint for both POST and GET requests
 * POST: Client sends JSON-RPC messages
 * GET: Client opens SSE stream for server-initiated communication
 *
 * Per MCP Streamable HTTP spec (2025-03-26):
 * - Must support both POST and GET on the same endpoint
 * - POST requires Accept header with application/json and/or text/event-stream
 * - Session ID should be validated if required
 */
app.all('/mcp', async (req, res) => {
  try {
    const body = req.body;
    
    // ========================================================================
    // DIRECT TOOL EXECUTION - NO SESSION REQUIRED
    // ========================================================================
    if (req.method === 'POST' && (body?.method === 'tools/call' || body?.method === 'tools/list')) {
      console.log(`[MCP Direct] ${body.method} - bypassing session requirement`);
      
      try {
        // Handle tools/list
        if (body.method === 'tools/list') {
          console.log('[MCP] tools/list received at Express layer — returning tools directly');
          res.json({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: getAllTools() }
          });
          return;
        }
        
        // Handle tools/call
        if (body.method === 'tools/call') {
          const { name, arguments: args } = body.params || {};
          
          console.log(`[MCP] Executing tool: ${name}`);
          console.log(`[MCP] Arguments:`, JSON.stringify(args, null, 2));
          
          let result;
          
          // Route to appropriate handler
          if (name.startsWith('sheets_') || [
            'initialize_sheet', 'add_customer_record', 'get_customer_record',
            'update_customer_record', 'search_customer_records', 'list_all_customers',
            'check_customer_history', 'get_service_pricing'
          ].includes(name)) {
            result = await handleSheetsTool(name, args || {});
          } else if (name.startsWith('calendly_') || [
            'list_event_types', 'get_event_type', 'get_scheduling_link',
            'list_scheduled_events', 'get_event_invitee', 'cancel_event',
            'create_event', 'event_type_available_times', 'create_appointment',
            'check_availability', 'book_appointment'
          ].includes(name)) {
            result = await handleCalendlyTool(name, args || {});
          } else if (name.startsWith('email_') || [
            'send_appointment_confirmation', 'send_appointment_reminder', 'send_custom_email'
          ].includes(name)) {
            result = await handleEmailTool(name, args || {});
          } else {
            throw new Error(`Unknown tool: ${name}`);
          }
          
          console.log(`[MCP] Tool result:`, JSON.stringify(result).substring(0, 200));
          
          res.json({
            jsonrpc: '2.0',
            id: body.id,
            result
          });
          return;
        }
      } catch (error) {
        console.error(`[MCP] Tool execution error:`, error);
        res.json({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Tool execution failed',
            data: { tool: body.params?.name }
          }
        });
        return;
      }
    }
    
    // ========================================================================
    // ORIGINAL SESSION-BASED HANDLER (for initialize and SSE streaming)
    // ========================================================================
    
    // Origin validation
    const origin = req.headers.origin;
    const allowedOrigins = [
      'https://agent-builder.platform.openai.com',
      'https://builder.platform.openai.com',
      'https://chatgpt.com',
    ];

    if (origin && !allowedOrigins.includes(origin)) {
      console.warn(`[MCP] Blocked request from disallowed origin: ${origin}`);
      res.status(403).send('Forbidden: Invalid Origin');
      return;
    }    
    
    // normalize incoming header and ignore empty values
    const rawSession = req.header('Mcp-Session-Id') || req.header('mcp-session-id') || '';
    const sessionId = String(rawSession).trim() || undefined;
    let transport: StreamableHTTPServerTransport;
    let currentSessionId: string;
 
    // Handle GET request (SSE stream)
    if (req.method === 'GET') {
      // For GET requests, session must already exist
      if (!sessionId || !activeTransports.has(sessionId)) {
        res.status(400).send('Bad Request: Session not found. Initialize session first via POST /mcp');
        return;
      }

      transport = activeTransports.get(sessionId)!;
      setSessionHeaders(res, sessionId);
      await transport.handleRequest(req, res);
      return;
    }
 
    // Handle POST request (JSON-RPC messages)
    if (req.method === 'POST') {
      const acceptHeader = String(req.headers.accept || '').toLowerCase();
      const accepted = req.accepts(['application/json', 'text/event-stream', '*/*']);
      if (!accepted) {
        console.warn(`[MCP] Unexpected Accept header: "${acceptHeader}". Proceeding anyway for compatibility.`);
      }

      // Handle initialize method specially
      if (req.body && req.body.method === 'initialize') {
        const rpcId = req.body.id ?? null;
        currentSessionId = randomUUID();
        console.log(`✨ Initialize request — creating session: ${currentSessionId}`);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => currentSessionId,
          onsessioninitialized: (sid: string) => {
            activeTransports.set(sid, transport);
            console.log(`✓ Session ${sid} initialized and stored in activeTransports`);
          },
          onsessionclosed: (sid: string) => {
            activeTransports.delete(sid);
            console.log(`✓ Session ${sid} closed and removed from activeTransports`);
          },
        });

        await mcpServer.connect(transport);
        activeTransports.set(currentSessionId, transport);
        console.log(`✓ Session ${currentSessionId} immediately stored in activeTransports`);

        setSessionHeaders(res, currentSessionId);
        console.log('[MCP] sent Mcp-Session-Id header for initialize:', currentSessionId);

        await transport.handleRequest(req, res, req.body);

        if (!res.headersSent) {
          res.json({
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: getAllTools() },
              serverInfo: { name: 'crm-mcp-server', version: '1.0.0' },
            },
          });
        }
        return;
      }

      // tools/list and tools/call are handled by the middleware above.
      // This handler only processes initialize and other MCP methods.

      if (sessionId && activeTransports.has(sessionId)) {
        // Reuse existing transport for this session
        console.log(`♻️ Reusing existing session: ${sessionId}`);
        currentSessionId = sessionId;
        transport = activeTransports.get(sessionId)!;
      } else {
        // Create new transport - generate session ID first
        currentSessionId = randomUUID();
        console.log(`✨ Creating new session: ${currentSessionId}`);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => currentSessionId,
          onsessioninitialized: (sid: string) => {
            activeTransports.set(sid, transport);
            console.log(`✓ Session ${sid} initialized and stored in activeTransports`);
          },
          onsessionclosed: (sid: string) => {
            activeTransports.delete(sid);
            console.log(`✓ Session ${sid} closed and removed from activeTransports`);
          },
        });

        // Connect transport to the MCP server
        await mcpServer.connect(transport);
      }
 
      setSessionHeaders(res, currentSessionId);
      console.log('[MCP] set Mcp-Session-Id header (HTTP response):', currentSessionId);

      await transport.handleRequest(req, res, req.body);
      return;
    }
 
    // Method not allowed
    res.status(405).send('Method Not Allowed');
  } catch (error) {
    console.error('❌ Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
        id: null,
      });
    }
  }
});





// Start server
app.listen(MCP_PORT, () => {
  console.log('\n========================================');
  console.log('🚀 MCP Server (Streamable HTTP Transport)');
  console.log('========================================\n');
  console.log(`Server running on: http://localhost:${MCP_PORT}`);
  console.log(`MCP endpoint: http://localhost:${MCP_PORT}/mcp`);
  console.log(`  - POST /mcp: Send JSON-RPC messages (initialize & communicate)`);
  console.log(`  - GET /mcp: Open SSE stream (requires active session)`);
  console.log(`Health check: http://localhost:${MCP_PORT}/health\n`);

  console.log('Configured services:');
  console.log(`  Google Sheets: ${!!(GOOGLE_SHEETS_CREDENTIALS_PATH && GOOGLE_SHEETS_SPREADSHEET_ID) ? '✓' : '✗'}`);
  console.log(`  Calendly: ${!!(CALENDLY_API_TOKEN && CALENDLY_ORGANIZATION_URI) ? '✓' : '✗'}`);
  console.log(`  SendGrid: ${!!(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL) ? '✓' : '✗'}\n`);

  console.log('Transport: Streamable HTTP (MCP spec 2025-03-26)');
  console.log('Features:');
  console.log('  ✓ Single endpoint for POST & GET requests');
  console.log('  ✓ Session management with Mcp-Session-Id header');
  console.log('  ✓ Origin header validation for security');
  console.log('  ✓ Accept header validation (application/json, text/event-stream)\n');

  console.log('For OpenAI Agent Builder / ChatGPT Apps:');
  console.log(`  MCP Server URL: http://localhost:${MCP_PORT}/mcp\n`);
  console.log('========================================\n');
});

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  // The SDK handles transport cleanup automatically
  console.log('Server shutdown complete');
  process.exit(0);
});

function setSessionHeaders(res: any, sessionId: string) {
  if (!res) return;
  try {
    // Node/Express response
    if (typeof res.setHeader === 'function') {
      res.setHeader('Mcp-Session-Id', sessionId);
      const existing = res.getHeader && res.getHeader('Access-Control-Expose-Headers');
      res.setHeader('Access-Control-Expose-Headers', existing ? String(existing) + ', Mcp-Session-Id' : 'Mcp-Session-Id');
      return;
    }
    // Fetch/Response-like headers object
    if (res.headers && typeof res.headers.set === 'function') {
      res.headers.set('Mcp-Session-Id', sessionId);
      res.headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      return;
    }
    // plain headers map
    if (res.headers && typeof res.headers === 'object') {
      res.headers['Mcp-Session-Id'] = sessionId;
      res.headers['Access-Control-Expose-Headers'] = (res.headers['Access-Control-Expose-Headers'] ? res.headers['Access-Control-Expose-Headers'] + ', Mcp-Session-Id' : 'Mcp-Session-Id');
    }
  } catch (err) {
    /* ignore */
  }
}
