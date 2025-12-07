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
        headers: { 'Mcp-Session-Id': sessionId, 'Access-Control-Expose-Headers': 'Mcp-Session-Id' },
        content: [{ type: 'text', text: 'Initialized' }],
        sessionId,
      };
    }
    try {
      // Route to appropriate tool handler
      if (name.startsWith('sheets_') || ['initialize_sheet', 'add_customer_record', 'get_customer_record', 'update_customer_record', 'search_customer_records', 'list_all_customers', 'check_customer_history'].includes(name)) {
        return await handleSheetsTool(name, args);
      } else if (name.startsWith('calendly_') || ['list_event_types', 'get_event_type', 'get_scheduling_link', 'list_scheduled_events', 'get_event_invitee', 'cancel_event','create_event'].includes(name)) {
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
        description: 'Retrieve a specific customer record by ID',
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
        name: 'list_scheduled_events',
        description: 'List scheduled events within a date range',
        inputSchema: {
          type: 'object',
          properties: {
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
  if (!sheetsClient || !GOOGLE_SHEETS_SPREADSHEET_ID) {
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
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const row = [
    id,
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

  await sheetsClient.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
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
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = result.data.values || [];
  const recordRow = rows.find((row: any[]) => row[0] === id);

  if (!recordRow) {
    return {
      content: [
        {
          type: 'text',
          text: `No customer record found with ID: ${id}`,
        },
      ],
    };
  }

  const record = {
    id: recordRow[0],
    name: recordRow[1],
    email: recordRow[2],
    phone: recordRow[3],
    issue: recordRow[4],
    status: recordRow[5],
    priority: recordRow[6],
    createdAt: recordRow[7],
    updatedAt: recordRow[8],
    notes: recordRow[9],
  };

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
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = result.data.values || [];
  const rowIndex = rows.findIndex((row: any[]) => row[0] === update.id);

  if (rowIndex === -1) {
    return {
      content: [
        {
          type: 'text',
          text: `No customer record found with ID: ${update.id}`,
        },
      ],
    };
  }

  const existingRow = rows[rowIndex];
  const updatedRow = [
    existingRow[0], // ID remains the same
    update.name !== undefined ? update.name : existingRow[1],
    update.email !== undefined ? update.email : existingRow[2],
    update.phone !== undefined ? update.phone : existingRow[3],
    update.issue !== undefined ? update.issue : existingRow[4],
    update.status !== undefined ? update.status : existingRow[5],
    update.priority !== undefined ? update.priority : existingRow[6],
    existingRow[7], // Created at remains the same
    new Date().toISOString(), // Updated at
    update.notes !== undefined ? update.notes : existingRow[9],
  ];

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex + 1}:J${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [updatedRow],
    },
  });

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
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = result.data.values || [];
  const matchingRecords = rows.slice(1).filter((row: any[]) => {
    if (criteria.email && row[2] !== criteria.email) return false;
    if (criteria.name && !row[1].toLowerCase().includes(criteria.name.toLowerCase())) return false;
    if (criteria.status && row[5] !== criteria.status) return false;
    if (criteria.priority && row[6] !== criteria.priority) return false;
    return true;
  });

  const records = matchingRecords.map((row: any[]) => ({
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
        text: `Found ${records.length} matching records:\n${JSON.stringify(records, null, 2)}`,
      },
    ],
  };
}

async function listAllCustomers(): Promise<any> {
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = result.data.values || [];
  const records = rows.slice(1).map((row: any[]) => ({
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

async function checkCustomerHistory(phoneNumber: string): Promise<any> {
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = result.data.values || [];
  const matchingRecords = rows.slice(1).filter((row: any[]) => row[3] === phoneNumber);

  const records = matchingRecords.map((row: any[]) => ({
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
        text: `Found ${records.length} records for phone ${phoneNumber}:\n${JSON.stringify(records, null, 2)}`,
      },
    ],
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
    case 'list_scheduled_events':
      return await listScheduledEvents(args);
    case 'get_event_invitee':
      return await getEventInvitee(args.inviteeUri);
    case 'cancel_event':
      return await cancelEvent(args.eventUri, args.reason);
    case 'create_event':
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
  if (params.minStartTime) {
    queryParams += `&min_start_time=${encodeURIComponent(params.minStartTime)}`;
  }
  if (params.maxStartTime) {
    queryParams += `&max_start_time=${encodeURIComponent(params.maxStartTime)}`;
  }

  const data = await calendlyRequest(`/scheduled_events?${queryParams}`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data.collection, null, 2),
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

// Add this after cancelEvent() function
async function createEvent(details: {
  eventTypeUri: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  preferredDate?: string;
  notes?: string;
}): Promise<any> {
  try {
    // Step 1: Get event type details
    const eventTypeId = details.eventTypeUri.split('/').pop();
    const eventTypeData = await calendlyRequest(`/event_types/${eventTypeId}`);
    const eventType = eventTypeData.resource;

    // Step 2: Check availability if preferred date provided
    let availabilityInfo = null;
    if (details.preferredDate) {
      try {
        const date = new Date(details.preferredDate);
        const startTime = new Date(date.setHours(0, 0, 0, 0)).toISOString();
        const endTime = new Date(date.setHours(23, 59, 59, 999)).toISOString();

        const availabilityData = await calendlyRequest(
          `/event_type_available_times?event_type=${encodeURIComponent(details.eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`
        );

        if (availabilityData.collection && availabilityData.collection.length > 0) {
          availabilityInfo = {
            date: details.preferredDate,
            slots_available: availabilityData.collection.length,
            first_available_slots: availabilityData.collection.slice(0, 5).map((slot: any) => ({
              start_time: slot.start_time,
              status: slot.status,
              invitees_remaining: slot.invitees_remaining,
            })),
          };
        } else {
          availabilityInfo = {
            date: details.preferredDate,
            slots_available: 0,
            message: 'No availability on preferred date',
          };
        }
      } catch (error) {
        console.error('Could not fetch availability:', error);
        availabilityInfo = {
          date: details.preferredDate,
          error: 'Could not check availability',
        };
      }
    }

    // Step 3: Create one-time scheduling link
    const linkResponse = await calendlyRequest('/scheduling_links', {
      method: 'POST',
      body: JSON.stringify({
        max_event_count: 1,
        owner: details.eventTypeUri,
        owner_type: 'EventType',
      }),
    });

    const schedulingUrl = linkResponse.resource.booking_url;

    // Step 4: Build pre-filled URL with customer information
    const params = new URLSearchParams();
    params.append('name', details.customerName);
    params.append('email', details.customerEmail);

    if (details.customerPhone) {
      params.append('a1', details.customerPhone); // a1 is typically the phone field
    }

    if (details.notes) {
      params.append('a2', details.notes); // a2 for additional notes
    }

    const prefilledUrl = `${schedulingUrl}?${params.toString()}`;

    // Step 5: Build comprehensive response
    const response = {
      success: true,
      message: 'Appointment booking initiated successfully',
      booking_url: prefilledUrl,
      booking_url_short: schedulingUrl,
      expires_after: '1 booking',
      event_details: {
        name: eventType.name,
        duration: `${eventType.duration} minutes`,
        description: eventType.description_plain || 'No description',
        scheduling_url: eventType.scheduling_url,
      },
      customer: {
        name: details.customerName,
        email: details.customerEmail,
        phone: details.customerPhone || 'Not provided',
        notes: details.notes || 'None',
      },
      ...(availabilityInfo && { availability: availabilityInfo }),
      workflow: {
        current_step: 'Link generated',
        status: 'Awaiting customer confirmation',
        next_steps: [
          '1. Send booking link to customer via email or SMS',
          '2. Customer clicks link and views available time slots',
          '3. Customer selects preferred time',
          '4. Customer confirms booking',
          '5. Both parties receive confirmation emails',
          '6. Event added to calendars',
        ],
      },
      email_template: `Hi ${details.customerName},\n\nThank you for choosing our service! Please use the link below to schedule your appointment:\n\n${prefilledUrl}\n\nYou can select a time that works best for you from the available slots.\n\nBest regards,\nThe Team`,
      sms_template: `Hi ${details.customerName}, schedule your appointment here: ${prefilledUrl}`,
    };

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
    const allowedHosts = ['localhost', '127.0.0.1', 'openai.com','ngrok-free.app', 'ngrok.app','api.openai.com'];
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
    // (removed duplicate empty log)
    console.log('Active sessions:', Array.from(activeTransports.keys()));
    console.log('========================================\n');
    next();
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
    // Validate Origin header for security
    if (!validateOrigin(req)) {
      console.warn(`Invalid origin: ${req.headers.origin}`);
      res.status(403).send('Forbidden: Invalid origin');
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
+      // echo session id on GET responses to ensure client can read it
+      setSessionHeaders(res, sessionId);
       await transport.handleRequest(req, res);
       return;
     }
 
     // Handle POST request (JSON-RPC messages)
     if (req.method === 'POST') {
      const acceptHeader = String(req.headers.accept || '').toLowerCase();
      // Prefer Express content negotiation but be permissive: log unexpected values and continue
      const accepted = req.accepts(['application/json', 'text/event-stream', '*/*']);
      if (!accepted) {
        console.warn(`[MCP] Unexpected Accept header: "${acceptHeader}". Proceeding anyway for compatibility.`);
      }

      // If client is calling initialize via JSON-RPC, handle it here so we can
      // guarantee the HTTP response contains Mcp-Session-Id header.
      // This avoids relying on the SDK transport to propagate custom headers.
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

        // connect transport so SDK handlers are wired for subsequent calls/GET SSE
        await mcpServer.connect(transport);

        // Immediately register the transport so subsequent requests can find it
        activeTransports.set(currentSessionId, transport);
        console.log(`✓ Session ${currentSessionId} immediately stored in activeTransports`);

        // set header on the real Express response (best-effort)
        setSessionHeaders(res, currentSessionId);
        console.log('[MCP] sent Mcp-Session-Id header for initialize:', currentSessionId);

        // Forward the initialize JSON-RPC to the SDK transport so the server
        // processes the handshake and marks the session initialized.
        // This lets the SDK update its internal state (tools, session ready).
        await transport.handleRequest(req, res, req.body);

        // transport.handleRequest should send the JSON-RPC response; if it
        // does not, fall back to sending a minimal initialize result.
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

      // If OpenAI asks for tools/list directly (common during onboarding),
      // respond immediately from Express so the control plane gets the tool list
      // even if a session wasn't created by initialize.
      if (req.body && req.body.method === 'tools/list') {
        const rpcId = req.body.id ?? null;
        console.log('[MCP] tools/list received at Express layer — returning tools directly');
        res.json({
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            tools: getAllTools(),
          },
        });
        return;
      }

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
 
      // ensure HTTP response includes the session id before transport writes
      setSessionHeaders(res, currentSessionId);
      console.log('[MCP] set Mcp-Session-Id header (HTTP response):', currentSessionId);

      // Handle the request
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
