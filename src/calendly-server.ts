import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import { AppointmentDetails } from './types.js';

const CALENDLY_API_BASE = 'https://api.calendly.com';

export class CalendlyMCPServer {
  private server: Server;
  private apiToken: string;
  private organizationUri: string;

  constructor(apiToken: string, organizationUri: string) {
    this.apiToken = apiToken;
    this.organizationUri = organizationUri;

    // Initialize MCP Server
    this.server = new Server(
      {
        name: 'calendly-appointments',
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
      const { name } = request.params;
      const args: any = request.params.arguments ?? {};

      try {
        switch (name) {
          case 'list_event_types':
            return await this.listEventTypes();
          case 'get_event_type':
            return await this.getEventType((args as any).eventTypeUri as string);
          case 'get_scheduling_link':
            return await this.getSchedulingLink((args as any).eventTypeUri as string);
          case 'list_scheduled_events':
            return await this.listScheduledEvents(args as any);
          case 'get_event_invitee':
            return await this.getEventInvitee((args as any).inviteeUri as string);
          case 'cancel_event':
            return await this.cancelEvent((args as any).eventUri as string, (args as any).reason as string);
          case 'check_availability':
            return await this.checkAvailability((args as any).eventTypeUri as string, (args as any).startTime as string, (args as any).endTime as string);
          case 'book_appointment':
            return await this.bookAppointment(args as any);
          case 'create_event':
            return await this.createEvent(args as any);
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
      // Add to getTools()
        {
          name: 'create_event',
          description: 'Initiate appointment booking workflow. Creates scheduling link and provides automation instructions.',
          inputSchema: {
            type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The Calendly event type URI',
            },
            customerName: {
              type: 'string',
              description: 'Customer full name',
            },
            customerEmail: {
              type: 'string',
              description: 'Customer email address',
            },
            customerPhone: {
              type: 'string',
              description: 'Customer phone number (optional)',
            },
            preferredDate: {
              type: 'string',
              description: 'Preferred date in ISO format (optional)',
            },
            notes: {
              type: 'string',
              description: 'Additional booking notes (optional)',
            },
          },
          required: ['eventTypeUri', 'customerName', 'customerEmail'],
        },
      },
      {
        name: 'list_event_types',
        description: 'List all available Calendly event types for booking appointments',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_event_type',
        description: 'Get details about a specific event type',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The URI of the event type',
            },
          },
          required: ['eventTypeUri'],
        },
      },
      {
        name: 'get_scheduling_link',
        description: 'Get the scheduling link for a specific event type to share with customers',
        inputSchema: {
          type: 'object',
          properties: {
            eventTypeUri: {
              type: 'string',
              description: 'The URI of the event type',
            },
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
        description: 'Get details about an event invitee (the person who booked)',
        inputSchema: {
          type: 'object',
          properties: {
            inviteeUri: {
              type: 'string',
              description: 'The URI of the invitee',
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
              description: 'The URI of the event to cancel',
            },
            reason: {
              type: 'string',
              description: 'Reason for cancellation',
            },
          },
          required: ['eventUri'],
        },
      },
      {
        name: 'check_availability',
        description: 'Check available appointment slots for a specific event type within a date range',
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
    ];
  }

  private async makeCalendlyRequest(endpoint: string, options: any = {}): Promise<any> {
    const url = `${CALENDLY_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Calendly API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  private async listEventTypes() {
    try {
      const data: any = await this.makeCalendlyRequest(
        `/event_types?organization=${encodeURIComponent(this.organizationUri)}`
      );

      const eventTypes = data.collection.map((event: any) => ({
        uri: event.uri,
        name: event.name,
        slug: event.slug,
        scheduling_url: event.scheduling_url,
        duration: event.duration,
        active: event.active,
        description: event.description_plain,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Available event types:\n${JSON.stringify(eventTypes, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list event types: ${error}`);
    }
  }

  private async getEventType(eventTypeUri: string) {
    try {
      const data: any = await this.makeCalendlyRequest(`/event_types/${encodeURIComponent(eventTypeUri)}`);

      const eventType = {
        uri: data.resource.uri,
        name: data.resource.name,
        slug: data.resource.slug,
        scheduling_url: data.resource.scheduling_url,
        duration: data.resource.duration,
        active: data.resource.active,
        description: data.resource.description_plain,
        color: data.resource.color,
        kind: data.resource.kind,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(eventType, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get event type: ${error}`);
    }
  }

  private async getSchedulingLink(eventTypeUri: string) {
    try {
      const data: any = await this.makeCalendlyRequest(`/event_types/${encodeURIComponent(eventTypeUri)}`);

      return {
        content: [
          {
            type: 'text',
            text: `Scheduling link: ${data.resource.scheduling_url}\n\nShare this link with customers to book appointments for: ${data.resource.name}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get scheduling link: ${error}`);
    }
  }

  private async listScheduledEvents(filters: any) {
    try {
      // Get current user to filter their events
      const userData: any = await this.makeCalendlyRequest('/users/me');
      const userUri = userData.resource.uri;

      let endpoint = `/scheduled_events?user=${encodeURIComponent(userUri)}`;

      if (filters.status) {
        endpoint += `&status=${filters.status}`;
      }
      if (filters.minStartTime) {
        endpoint += `&min_start_time=${encodeURIComponent(filters.minStartTime)}`;
      }
      if (filters.maxStartTime) {
        endpoint += `&max_start_time=${encodeURIComponent(filters.maxStartTime)}`;
      }

      const data: any = await this.makeCalendlyRequest(endpoint);

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
    } catch (error) {
      throw new Error(`Failed to list scheduled events: ${error}`);
    }
  }

  private async getEventInvitee(inviteeUri: string) {
    try {
      const data: any = await this.makeCalendlyRequest(`/scheduled_events/${encodeURIComponent(inviteeUri)}/invitees`);

      const invitees = data.collection.map((invitee: any) => ({
        uri: invitee.uri,
        email: invitee.email,
        name: invitee.name,
        status: invitee.status,
        questions_and_answers: invitee.questions_and_answers,
        timezone: invitee.timezone,
        created_at: invitee.created_at,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(invitees, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get event invitee: ${error}`);
    }
  }

  private async cancelEvent(eventUri: string, reason?: string) {
    try {
      await this.makeCalendlyRequest(`/scheduled_events/${encodeURIComponent(eventUri)}/cancellation`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason || 'Event cancelled',
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Event cancelled successfully. Reason: ${reason || 'Event cancelled'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to cancel event: ${error}`);
    }
  }

  private async checkAvailability(eventTypeUri: string, startTime: string, endTime: string) {
    try {
      const endpoint = `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;

      const data: any = await this.makeCalendlyRequest(endpoint);

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
    } catch (error) {
      throw new Error(`Failed to check availability: ${error}`);
    }
  }

  private async bookAppointment(details: { eventTypeUri: string; name: string; email: string; phone?: string }) {
    try {
      // Get the event type details to fetch the scheduling URL
      const eventTypeData: any = await this.makeCalendlyRequest(`/event_types/${encodeURIComponent(details.eventTypeUri)}`);

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
    } catch (error) {
      throw new Error(`Failed to generate booking link: ${error}`);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Calendly MCP server running on stdio');
  }



  // Add this method
  private async createEvent(details: {
    eventTypeUri: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    preferredDate?: string;
    notes?: string;
  }) {
    try {
      // Step 1: Get event type details
      const eventTypeData: any = await this.makeCalendlyRequest(
        `/event_types/${details.eventTypeUri.split('/').pop()}`
      );

      // Step 2: Check availability if preferred date provided
      let availableSlots = null;
      if (details.preferredDate) {
        const date = new Date(details.preferredDate);
        const startTime = new Date(date.setHours(0, 0, 0, 0)).toISOString();
        const endTime = new Date(date.setHours(23, 59, 59, 999)).toISOString();

        try {
          const availabilityData: any = await this.makeCalendlyRequest(
            `/event_type_available_times?event_type=${encodeURIComponent(details.eventTypeUri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`
          );
          
          availableSlots = availabilityData.collection.slice(0, 5).map((slot: any) => ({
            start_time: slot.start_time,
            status: slot.status,
          }));
        } catch (error) {
          console.error('Could not fetch availability:', error);
        }
      }

      // Step 3: Create one-time scheduling link
      const linkResponse = await this.makeCalendlyRequest('/scheduling_links', {
        method: 'POST',
        body: JSON.stringify({
          max_event_count: 1,
          owner: details.eventTypeUri,
          owner_type: 'EventType',
        }),
      });

      const schedulingUrl = linkResponse.resource.booking_url;

      // Step 4: Build pre-filled URL
      const params = new URLSearchParams();
      params.append('name', details.customerName);
      params.append('email', details.customerEmail);
      
      if (details.customerPhone) {
        params.append('a1', details.customerPhone);
      }
      
      if (details.notes) {
        params.append('a2', details.notes);
      }

      const prefilledUrl = `${schedulingUrl}?${params.toString()}`;

      // Step 5: Build comprehensive response
      const response = {
        success: true,
        message: 'Appointment booking initiated',
        event_type: {
          name: eventTypeData.resource.name,
          duration: eventTypeData.resource.duration,
          description: eventTypeData.resource.description_plain,
        },
        customer: {
          name: details.customerName,
          email: details.customerEmail,
          phone: details.customerPhone || 'Not provided',
        },
        booking_url: prefilledUrl,
        scheduling_url_expires: 'After 1 booking',
        ...(availableSlots && {
          available_slots_on_preferred_date: availableSlots,
          preferred_date: details.preferredDate,
        }),
        workflow: {
          step: 1,
          status: 'awaiting_customer_confirmation',
          next_steps: [
            'Send booking link to customer via email or SMS',
            'Customer selects available time slot',
            'Customer confirms booking',
            'System sends confirmation emails',
            'Event appears in both calendars',
          ],
        },
        automation_options: {
          email_template: `Hi ${details.customerName},\n\nThank you for booking with us! Please click the link below to select your preferred appointment time:\n\n${prefilledUrl}\n\nBest regards`,
          sms_template: `Hi ${details.customerName}, book your appointment here: ${prefilledUrl}`,
        },
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
      throw new Error(`Failed to create event: ${error}`);
    }
}
 
}
