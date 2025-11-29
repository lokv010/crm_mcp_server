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
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_event_types':
            return await this.listEventTypes();
          case 'get_event_type':
            return await this.getEventType(args.eventTypeUri as string);
          case 'get_scheduling_link':
            return await this.getSchedulingLink(args.eventTypeUri as string);
          case 'list_scheduled_events':
            return await this.listScheduledEvents(args);
          case 'get_event_invitee':
            return await this.getEventInvitee(args.inviteeUri as string);
          case 'cancel_event':
            return await this.cancelEvent(args.eventUri as string, args.reason as string);
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
    ];
  }

  private async makeCalendlyRequest(endpoint: string, options: any = {}) {
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
      const data = await this.makeCalendlyRequest(
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
      const data = await this.makeCalendlyRequest(`/event_types/${encodeURIComponent(eventTypeUri)}`);

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
      const data = await this.makeCalendlyRequest(`/event_types/${encodeURIComponent(eventTypeUri)}`);

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
      const userData = await this.makeCalendlyRequest('/users/me');
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

      const data = await this.makeCalendlyRequest(endpoint);

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
      const data = await this.makeCalendlyRequest(`/scheduled_events/${encodeURIComponent(inviteeUri)}/invitees`);

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

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Calendly MCP server running on stdio');
  }
}
