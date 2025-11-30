#!/usr/bin/env node

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import { MCPBridge, MCPToolCall } from './mcp-bridge.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.REST_API_PORT || '3000', 10);
const API_KEY = process.env.REST_API_KEY;

// Initialize MCP Bridge
const mcpBridge = new MCPBridge();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// API Key authentication middleware
const authenticateApiKey = (req: Request, res: Response, next: NextFunction) => {
  // Skip authentication if no API key is configured
  if (!API_KEY) {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey || apiKey !== API_KEY) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing API key',
    });
    return;
  }

  next();
};

// Apply authentication to all /api routes
app.use('/api', authenticateApiKey);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// ============================================
// API Routes
// ============================================

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    servers: mcpBridge.getAvailableServers(),
  });
});

/**
 * GET / - Root endpoint with API information
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'CRM MCP REST API',
    version: '1.0.0',
    description: 'REST API wrapper for MCP servers (Google Sheets CRM and Calendly)',
    documentation: '/api/docs',
    endpoints: {
      health: 'GET /health',
      servers: 'GET /api/servers',
      tools: 'GET /api/servers/:server/tools',
      allTools: 'GET /api/tools',
      callTool: 'POST /api/servers/:server/tools/:tool',
      genericCall: 'POST /api/call',
      checkCustomer: 'GET /api/google-sheets/check-customer',
      listAvailability: 'GET /api/calendly/list-availability',
      scheduleEvent: 'POST /api/calendly/schedule-event',
    },
    authentication: API_KEY ? 'API Key required (x-api-key header or api_key query param)' : 'No authentication required',
  });
});

/**
 * GET /api/servers - List all available MCP servers
 */
app.get('/api/servers', async (req: Request, res: Response) => {
  try {
    const servers = mcpBridge.getAvailableServers();
    const serverDetails = await Promise.all(
      servers.map(async (serverName) => {
        const info = await mcpBridge.getServerInfo(serverName);
        return {
          name: serverName,
          displayName: info?.name || serverName,
          description: info?.description || '',
          toolCount: info?.tools.length || 0,
        };
      })
    );

    res.json({
      success: true,
      servers: serverDetails,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/servers/:server/tools - List all tools for a specific server
 */
app.get('/api/servers/:server/tools', async (req: Request, res: Response) => {
  try {
    const serverName = req.params.server;
    const info = await mcpBridge.getServerInfo(serverName);

    if (!info) {
      res.status(404).json({
        success: false,
        error: `Server '${serverName}' not found`,
      });
      return;
    }

    res.json({
      success: true,
      server: {
        name: serverName,
        displayName: info.name,
        description: info.description,
      },
      tools: info.tools,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/tools - List all tools from all servers
 */
app.get('/api/tools', async (req: Request, res: Response) => {
  try {
    const allTools = await mcpBridge.getAllTools();

    res.json({
      success: true,
      tools: allTools,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/servers/:server/tools/:tool - Execute a tool on a specific server
 */
app.post('/api/servers/:server/tools/:tool', async (req: Request, res: Response) => {
  try {
    const serverName = req.params.server;
    const toolName = req.params.tool;
    const args = req.body || {};

    // Validate tool exists
    const isValid = await mcpBridge.validateTool(serverName, toolName);
    if (!isValid) {
      res.status(404).json({
        success: false,
        error: `Tool '${toolName}' not found on server '${serverName}'`,
      });
      return;
    }

    const call: MCPToolCall = {
      server: serverName,
      tool: toolName,
      arguments: args,
    };

    const result = await mcpBridge.callTool(call);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/call - Generic endpoint to call any tool
 * Body: { server: string, tool: string, arguments?: object }
 */
app.post('/api/call', async (req: Request, res: Response) => {
  try {
    const { server, tool, arguments: args } = req.body;

    if (!server || !tool) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: server and tool',
      });
      return;
    }

    const call: MCPToolCall = {
      server,
      tool,
      arguments: args || {},
    };

    const result = await mcpBridge.callTool(call);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/google-sheets/check-customer - Check customer history by phone number
 */
app.get('/api/google-sheets/check-customer', async (req: Request, res: Response) => {
  try {
    const phoneNumber = req.query.phone_number as string;

    if (!phoneNumber) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameter: phone_number',
      });
      return;
    }

    const call: MCPToolCall = {
      server: 'sheets',
      tool: 'check_customer_history',
      arguments: { phone_number: phoneNumber },
    };

    const result = await mcpBridge.callTool(call);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/calendly/list-availability - Check available appointment slots
 */
app.get('/api/calendly/list-availability', async (req: Request, res: Response) => {
  try {
    const { event_type_uri, start_time, end_time } = req.query;

    if (!event_type_uri || !start_time || !end_time) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameters: event_type_uri, start_time, end_time',
      });
      return;
    }

    const call: MCPToolCall = {
      server: 'calendly',
      tool: 'check_availability',
      arguments: {
        eventTypeUri: event_type_uri as string,
        startTime: start_time as string,
        endTime: end_time as string,
      },
    };

    const result = await mcpBridge.callTool(call);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/calendly/schedule-event - Generate booking link for appointment
 */
app.post('/api/calendly/schedule-event', async (req: Request, res: Response) => {
  try {
    const { event_type_uri, name, email, phone } = req.body;

    if (!event_type_uri || !name || !email) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: event_type_uri, name, email',
      });
      return;
    }

    const call: MCPToolCall = {
      server: 'calendly',
      tool: 'book_appointment',
      arguments: {
        eventTypeUri: event_type_uri,
        name,
        email,
        phone,
      },
    };

    const result = await mcpBridge.callTool(call);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/docs - API Documentation
 */
app.get('/api/docs', async (req: Request, res: Response) => {
  try {
    const servers = mcpBridge.getAvailableServers();
    const serverInfos = await Promise.all(
      servers.map((name) => mcpBridge.getServerInfo(name))
    );

    const docs = {
      title: 'CRM MCP REST API Documentation',
      version: '1.0.0',
      baseUrl: `http://localhost:${PORT}`,
      authentication: API_KEY
        ? {
            type: 'API Key',
            header: 'x-api-key',
            alternativeQueryParam: 'api_key',
            note: 'Include your API key in the x-api-key header or api_key query parameter',
          }
        : {
            type: 'None',
            note: 'No authentication configured. Set REST_API_KEY in .env to enable.',
          },
      endpoints: [
        {
          path: '/health',
          method: 'GET',
          description: 'Health check endpoint',
          authentication: false,
        },
        {
          path: '/api/servers',
          method: 'GET',
          description: 'List all available MCP servers',
          authentication: true,
        },
        {
          path: '/api/servers/:server/tools',
          method: 'GET',
          description: 'List all tools for a specific server',
          authentication: true,
          parameters: [
            {
              name: 'server',
              in: 'path',
              required: true,
              description: 'Server name (e.g., "sheets" or "calendly")',
            },
          ],
        },
        {
          path: '/api/tools',
          method: 'GET',
          description: 'List all tools from all servers',
          authentication: true,
        },
        {
          path: '/api/servers/:server/tools/:tool',
          method: 'POST',
          description: 'Execute a tool on a specific server',
          authentication: true,
          parameters: [
            {
              name: 'server',
              in: 'path',
              required: true,
              description: 'Server name',
            },
            {
              name: 'tool',
              in: 'path',
              required: true,
              description: 'Tool name',
            },
          ],
          requestBody: {
            description: 'Tool arguments as JSON object',
            example: { name: 'John Doe', email: 'john@example.com' },
          },
        },
        {
          path: '/api/call',
          method: 'POST',
          description: 'Generic endpoint to call any tool',
          authentication: true,
          requestBody: {
            required: ['server', 'tool'],
            properties: {
              server: { type: 'string', description: 'Server name' },
              tool: { type: 'string', description: 'Tool name' },
              arguments: { type: 'object', description: 'Tool arguments' },
            },
            example: {
              server: 'sheets',
              tool: 'add_customer_record',
              arguments: {
                name: 'John Doe',
                email: 'john@example.com',
                issue: 'Login problem',
                status: 'open',
                priority: 'high',
              },
            },
          },
        },
      ],
      servers: serverInfos
        .filter((info) => info !== null)
        .map((info) => ({
          name: info!.name,
          description: info!.description,
          tools: info!.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        })),
      examples: [
        {
          title: 'List all servers',
          request: 'GET /api/servers',
          curl: `curl -H "x-api-key: YOUR_API_KEY" http://localhost:${PORT}/api/servers`,
        },
        {
          title: 'Add customer record',
          request: 'POST /api/servers/sheets/tools/add_customer_record',
          curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"John Doe","email":"john@example.com","issue":"Login problem","status":"open","priority":"high"}' \\
  http://localhost:${PORT}/api/servers/sheets/tools/add_customer_record`,
        },
        {
          title: 'Check customer history by phone',
          request: 'GET /api/google-sheets/check-customer',
          curl: `curl -H "x-api-key: YOUR_API_KEY" "http://localhost:${PORT}/api/google-sheets/check-customer?phone_number=555-1234"`,
        },
        {
          title: 'Check availability',
          request: 'GET /api/calendly/list-availability',
          curl: `curl -H "x-api-key: YOUR_API_KEY" "http://localhost:${PORT}/api/calendly/list-availability?event_type_uri=https://api.calendly.com/event_types/XXXXXX&start_time=2024-01-15T00:00:00Z&end_time=2024-01-22T23:59:59Z"`,
        },
        {
          title: 'Schedule appointment',
          request: 'POST /api/calendly/schedule-event',
          curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"event_type_uri":"https://api.calendly.com/event_types/XXXXXX","name":"John Doe","email":"john@example.com","phone":"555-1234"}' \\
  http://localhost:${PORT}/api/calendly/schedule-event`,
        },
        {
          title: 'List Calendly event types',
          request: 'POST /api/servers/calendly/tools/list_event_types',
          curl: `curl -X POST -H "x-api-key: YOUR_API_KEY" http://localhost:${PORT}/api/servers/calendly/tools/list_event_types`,
        },
      ],
    };

    res.json(docs);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /openapi.json - OpenAPI 3.0 Specification for OpenAI Agent Builder
 */
app.get('/openapi.json', async (req: Request, res: Response) => {
  try {
    const servers = mcpBridge.getAvailableServers();
    const allTools = await mcpBridge.getAllTools();

    // Build OpenAPI paths dynamically from available tools
    const paths: Record<string, any> = {
      '/health': {
        get: {
          summary: 'Health check endpoint',
          operationId: 'healthCheck',
          responses: {
            '200': {
              description: 'Server health status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      timestamp: { type: 'string' },
                      servers: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/servers': {
        get: {
          summary: 'List all available MCP servers',
          operationId: 'listServers',
          responses: {
            '200': {
              description: 'List of servers',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      servers: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            displayName: { type: 'string' },
                            description: { type: 'string' },
                            toolCount: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/tools': {
        get: {
          summary: 'List all tools from all servers',
          operationId: 'listAllTools',
          responses: {
            '200': {
              description: 'All available tools',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      tools: { type: 'object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // Add tool-specific endpoints
    for (const [serverName, tools] of Object.entries(allTools)) {
      for (const tool of tools) {
        const pathName = `/api/servers/${serverName}/tools/${tool.name}`;
        paths[pathName] = {
          post: {
            summary: tool.description || `Execute ${tool.name}`,
            operationId: `${serverName}_${tool.name}`,
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: tool.inputSchema || { type: 'object' },
                },
              },
            },
            responses: {
              '200': {
                description: 'Tool execution result',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        content: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              type: { type: 'string' },
                              text: { type: 'string' },
                            },
                          },
                        },
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '400': {
                description: 'Bad request',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      }
    }

    const openapi = {
      openapi: '3.0.0',
      info: {
        title: 'CRM MCP REST API',
        version: '1.0.0',
        description: 'REST API wrapper for MCP servers (Google Sheets CRM and Calendly)',
      },
      servers: [
        {
          url: `http://localhost:${PORT}`,
          description: 'Local development server',
        },
      ],
      paths,
      components: {
        securitySchemes: API_KEY
          ? {
              ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'x-api-key',
              },
            }
          : {},
      },
      security: API_KEY ? [{ ApiKeyAuth: [] }] : [],
    };

    res.json(openapi);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('🚀 CRM MCP REST API Server');
  console.log('========================================\n');
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`Health check: http://localhost:${PORT}/health\n`);

  const servers = mcpBridge.getAvailableServers();
  console.log(`Available MCP servers: ${servers.join(', ') || 'None configured'}\n`);

  if (API_KEY) {
    console.log('🔒 API Key authentication: ENABLED');
    console.log('   Include x-api-key header in requests\n');
  } else {
    console.log('⚠️  API Key authentication: DISABLED');
    console.log('   Set REST_API_KEY in .env to enable\n');
  }

  console.log('========================================\n');
});

export default app;
