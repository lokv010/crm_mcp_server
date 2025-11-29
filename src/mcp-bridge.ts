import { GoogleSheetsMCPServer } from './sheets-server.js';
import { CalendlyMCPServer } from './calendly-server.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface MCPToolCall {
  server: string;
  tool: string;
  arguments?: Record<string, any>;
}

export interface MCPToolResponse {
  success: boolean;
  content?: Array<{ type: string; text: string }>;
  error?: string;
}

export interface MCPServerInfo {
  name: string;
  description: string;
  tools: Tool[];
}

/**
 * Bridge adapter that allows calling MCP server tools programmatically
 * without using stdio transport. This enables REST API access to MCP functionality.
 */
export class MCPBridge {
  private sheetsServer?: GoogleSheetsMCPServer;
  private calendlyServer?: CalendlyMCPServer;
  private servers: Map<string, any> = new Map();

  constructor() {
    this.initializeServers();
  }

  private initializeServers() {
    // Initialize Google Sheets server if configured
    const sheetsCredentials = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
    const sheetsSpreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (sheetsCredentials && sheetsSpreadsheetId) {
      try {
        this.sheetsServer = new GoogleSheetsMCPServer(sheetsCredentials, sheetsSpreadsheetId);
        this.servers.set('sheets', this.sheetsServer);
        console.log('✓ Google Sheets MCP server initialized');
      } catch (error) {
        console.error('Failed to initialize Google Sheets server:', error);
      }
    }

    // Initialize Calendly server if configured
    const calendlyToken = process.env.CALENDLY_API_TOKEN;
    const calendlyOrgUri = process.env.CALENDLY_ORGANIZATION_URI;

    if (calendlyToken && calendlyOrgUri) {
      try {
        this.calendlyServer = new CalendlyMCPServer(calendlyToken, calendlyOrgUri);
        this.servers.set('calendly', this.calendlyServer);
        console.log('✓ Calendly MCP server initialized');
      } catch (error) {
        console.error('Failed to initialize Calendly server:', error);
      }
    }

    if (this.servers.size === 0) {
      console.warn('⚠ No MCP servers configured. Please check your .env file.');
    }
  }

  /**
   * Get list of available MCP servers
   */
  getAvailableServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Get server information including available tools
   */
  async getServerInfo(serverName: string): Promise<MCPServerInfo | null> {
    const server = this.servers.get(serverName);
    if (!server) {
      return null;
    }

    // Access the private getTools method by calling it through the server instance
    let tools: Tool[] = [];
    let name = '';
    let description = '';

    if (serverName === 'sheets' && this.sheetsServer) {
      tools = (this.sheetsServer as any).getTools();
      name = 'Google Sheets CRM';
      description = 'Customer relationship management with Google Sheets integration';
    } else if (serverName === 'calendly' && this.calendlyServer) {
      tools = (this.calendlyServer as any).getTools();
      name = 'Calendly Appointments';
      description = 'Schedule and manage appointments through Calendly';
    }

    return {
      name,
      description,
      tools,
    };
  }

  /**
   * Get all available tools from all servers
   */
  async getAllTools(): Promise<Record<string, Tool[]>> {
    const allTools: Record<string, Tool[]> = {};

    for (const serverName of this.servers.keys()) {
      const info = await this.getServerInfo(serverName);
      if (info) {
        allTools[serverName] = info.tools;
      }
    }

    return allTools;
  }

  /**
   * Call a tool on a specific MCP server
   */
  async callTool(call: MCPToolCall): Promise<MCPToolResponse> {
    const server = this.servers.get(call.server);

    if (!server) {
      return {
        success: false,
        error: `Server '${call.server}' not found or not configured`,
      };
    }

    try {
      let result: any;

      // Call the appropriate tool based on server and tool name
      if (call.server === 'sheets' && this.sheetsServer) {
        result = await this.callSheetsToolDirect(call.tool, call.arguments || {});
      } else if (call.server === 'calendly' && this.calendlyServer) {
        result = await this.callCalendlyToolDirect(call.tool, call.arguments || {});
      } else {
        return {
          success: false,
          error: `Unknown server: ${call.server}`,
        };
      }

      return {
        success: true,
        content: result.content,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Call Google Sheets tools directly
   */
  private async callSheetsToolDirect(toolName: string, args: any): Promise<any> {
    if (!this.sheetsServer) {
      throw new Error('Google Sheets server not initialized');
    }

    const server = this.sheetsServer as any;

    switch (toolName) {
      case 'initialize_sheet':
        return await server.initializeSheet();
      case 'add_customer_record':
        return await server.addCustomerRecord(args);
      case 'get_customer_record':
        return await server.getCustomerRecord(args.id);
      case 'update_customer_record':
        return await server.updateCustomerRecord(args);
      case 'search_customer_records':
        return await server.searchCustomerRecords(args);
      case 'list_all_customers':
        return await server.listAllCustomers();
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Call Calendly tools directly
   */
  private async callCalendlyToolDirect(toolName: string, args: any): Promise<any> {
    if (!this.calendlyServer) {
      throw new Error('Calendly server not initialized');
    }

    const server = this.calendlyServer as any;

    switch (toolName) {
      case 'list_event_types':
        return await server.listEventTypes();
      case 'get_event_type':
        return await server.getEventType(args.eventTypeUri);
      case 'get_scheduling_link':
        return await server.getSchedulingLink(args.eventTypeUri);
      case 'list_scheduled_events':
        return await server.listScheduledEvents(args);
      case 'get_event_invitee':
        return await server.getEventInvitee(args.inviteeUri);
      case 'cancel_event':
        return await server.cancelEvent(args.eventUri, args.reason);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Validate if a tool exists on a server
   */
  async validateTool(serverName: string, toolName: string): Promise<boolean> {
    const info = await this.getServerInfo(serverName);
    if (!info) {
      return false;
    }

    return info.tools.some((tool) => tool.name === toolName);
  }
}
