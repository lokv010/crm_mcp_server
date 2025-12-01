#!/usr/bin/env node

/**
 * MCP Server with HTTP/SSE Transport
 *
 * This is a proper MCP server that implements the Model Context Protocol.
 * It uses StreamableHTTPServerTransport to work with clients like OpenAI Agent Builder.
 *
 * The server aggregates tools from:
 * - Google Sheets CRM
 * - Calendly appointments
 * - SendGrid email notifications
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
const HEADERS = ['ID', 'Name', 'Email', 'Phone', 'Issue', 'Status', 'Priority', 'Created At', 'Updated At', 'Notes'];

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

  // Set up tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args: any = request.params.arguments ?? {};

    try {
      // Route to appropriate tool handler
      if (name.startsWith('sheets_') || ['initialize_sheet', 'add_customer_record', 'get_customer_record', 'update_customer_record', 'search_customer_records', 'list_all_customers', 'check_customer_history'].includes(name)) {
        return await handleSheetsTool(name, args);
      } else if (name.startsWith('calendly_') || ['list_event_types', 'get_event_type', 'get_scheduling_link', 'list_scheduled_events', 'get_event_invitee', 'cancel_event'].includes(name)) {
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

async function initializeSheet(): Promise<any> {
  const result = await sheetsClient.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
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
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
}));

// Create a single MCP server instance at startup
const mcpServer = createMCPServer();

// Simple map to track active transports by session ID
// The SDK manages session lifecycle via callbacks
const activeTransports = new Map<string, StreamableHTTPServerTransport>();

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

// MCP endpoint - POST requests for JSON-RPC messages
app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && activeTransports.has(sessionId)) {
      // Reuse existing transport for this session
      transport = activeTransports.get(sessionId)!;
    } else {
      // Create new transport - SDK will handle session lifecycle via callbacks
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          activeTransports.set(sid, transport);
          console.log(`Session ${sid} initialized`);
        },
        onsessionclosed: (sid: string) => {
          activeTransports.delete(sid);
          console.log(`Session ${sid} closed`);
        },
      });

      // Connect transport to the MCP server
      await mcpServer.connect(transport);
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
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

// SSE endpoint - GET /messages for Server-Sent Events stream
app.get('/messages', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !activeTransports.has(sessionId)) {
      res.status(400).send('Session not found. Initialize session first via POST /mcp');
      return;
    }

    const transport = activeTransports.get(sessionId)!;
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling SSE request:', error);
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE connection');
    }
  }
});

// Start server
app.listen(MCP_PORT, () => {
  console.log('\n========================================');
  console.log('🚀 MCP Server (HTTP/SSE Transport)');
  console.log('========================================\n');
  console.log(`Server running on: http://localhost:${MCP_PORT}`);
  console.log(`MCP endpoint: http://localhost:${MCP_PORT}/mcp`);
  console.log(`Health check: http://localhost:${MCP_PORT}/health\n`);

  console.log('Configured services:');
  console.log(`  Google Sheets: ${!!(GOOGLE_SHEETS_CREDENTIALS_PATH && GOOGLE_SHEETS_SPREADSHEET_ID) ? '✓' : '✗'}`);
  console.log(`  Calendly: ${!!(CALENDLY_API_TOKEN && CALENDLY_ORGANIZATION_URI) ? '✓' : '✗'}`);
  console.log(`  SendGrid: ${!!(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL) ? '✓' : '✗'}\n`);

  console.log('For OpenAI Agent Builder:');
  console.log(`  Use this MCP server URL: http://localhost:${MCP_PORT}/mcp\n`);
  console.log('========================================\n');
});

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  // The SDK handles transport cleanup automatically
  console.log('Server shutdown complete');
  process.exit(0);
});
