import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import sgMail from '@sendgrid/mail';
import { EmailConfirmation } from './types.js';

export class EmailMCPServer {
  private server: Server;
  private apiKey: string;
  private fromEmail: string;
  private fromName: string;

  constructor(apiKey: string, fromEmail: string, fromName: string = 'CRM Support') {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
    this.fromName = fromName;

    // Initialize SendGrid
    sgMail.setApiKey(this.apiKey);

    // Initialize MCP Server
    this.server = new Server(
      {
        name: 'email-notifications',
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
          case 'send_appointment_confirmation':
            return await this.sendAppointmentConfirmation(args as EmailConfirmation);
          case 'send_appointment_reminder':
            return await this.sendAppointmentReminder(args as EmailConfirmation);
          case 'send_custom_email':
            return await this.sendCustomEmail(args);
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
        name: 'send_appointment_confirmation',
        description: 'Send an appointment confirmation email with all booking details to the customer',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line (optional, will use default if not provided)',
            },
            customerName: {
              type: 'string',
              description: 'Customer name for personalization',
            },
            appointmentDetails: {
              type: 'object',
              description: 'Appointment information',
              properties: {
                eventType: {
                  type: 'string',
                  description: 'Type of appointment/event',
                },
                startTime: {
                  type: 'string',
                  description: 'Appointment start time (ISO 8601 format)',
                },
                endTime: {
                  type: 'string',
                  description: 'Appointment end time (ISO 8601 format)',
                },
                timezone: {
                  type: 'string',
                  description: 'Timezone for the appointment',
                },
                location: {
                  type: 'string',
                  description: 'Meeting location or link',
                },
              },
              required: ['eventType', 'startTime', 'timezone'],
            },
            additionalInfo: {
              type: 'string',
              description: 'Additional information or notes to include',
            },
          },
          required: ['to', 'customerName', 'appointmentDetails'],
        },
      },
      {
        name: 'send_appointment_reminder',
        description: 'Send an appointment reminder email to the customer',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line (optional, will use default if not provided)',
            },
            customerName: {
              type: 'string',
              description: 'Customer name for personalization',
            },
            appointmentDetails: {
              type: 'object',
              description: 'Appointment information',
              properties: {
                eventType: {
                  type: 'string',
                  description: 'Type of appointment/event',
                },
                startTime: {
                  type: 'string',
                  description: 'Appointment start time (ISO 8601 format)',
                },
                endTime: {
                  type: 'string',
                  description: 'Appointment end time (ISO 8601 format)',
                },
                timezone: {
                  type: 'string',
                  description: 'Timezone for the appointment',
                },
                location: {
                  type: 'string',
                  description: 'Meeting location or link',
                },
              },
              required: ['eventType', 'startTime', 'timezone'],
            },
            additionalInfo: {
              type: 'string',
              description: 'Additional information or notes to include',
            },
          },
          required: ['to', 'customerName', 'appointmentDetails'],
        },
      },
      {
        name: 'send_custom_email',
        description: 'Send a custom email with specified content',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line',
            },
            text: {
              type: 'string',
              description: 'Plain text email content',
            },
            html: {
              type: 'string',
              description: 'HTML email content (optional)',
            },
          },
          required: ['to', 'subject', 'text'],
        },
      },
    ];
  }

  private formatDateTime(dateTimeString: string, timezone: string): string {
    try {
      const date = new Date(dateTimeString);
      return `${date.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      })}`;
    } catch (error) {
      return dateTimeString;
    }
  }

  private createConfirmationHtml(confirmation: EmailConfirmation): string {
    const { customerName, appointmentDetails, additionalInfo } = confirmation;
    const formattedStartTime = this.formatDateTime(appointmentDetails.startTime, appointmentDetails.timezone);
    const formattedEndTime = appointmentDetails.endTime
      ? this.formatDateTime(appointmentDetails.endTime, appointmentDetails.timezone)
      : null;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #4CAF50;
      color: white;
      padding: 20px;
      text-align: center;
      border-radius: 5px 5px 0 0;
    }
    .content {
      background-color: #f9f9f9;
      padding: 30px;
      border: 1px solid #ddd;
      border-radius: 0 0 5px 5px;
    }
    .appointment-details {
      background-color: white;
      padding: 20px;
      margin: 20px 0;
      border-left: 4px solid #4CAF50;
      border-radius: 3px;
    }
    .detail-row {
      margin: 10px 0;
    }
    .detail-label {
      font-weight: bold;
      color: #555;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #777;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>✓ Appointment Confirmed</h1>
  </div>
  <div class="content">
    <p>Dear ${customerName},</p>
    <p>Your appointment has been successfully confirmed! We look forward to meeting with you.</p>

    <div class="appointment-details">
      <h2 style="margin-top: 0; color: #4CAF50;">Appointment Details</h2>

      <div class="detail-row">
        <span class="detail-label">Service:</span> ${appointmentDetails.eventType}
      </div>

      <div class="detail-row">
        <span class="detail-label">Date & Time:</span> ${formattedStartTime}
      </div>

      ${formattedEndTime ? `
      <div class="detail-row">
        <span class="detail-label">End Time:</span> ${formattedEndTime}
      </div>
      ` : ''}

      ${appointmentDetails.location ? `
      <div class="detail-row">
        <span class="detail-label">Location:</span> ${appointmentDetails.location}
      </div>
      ` : ''}
    </div>

    ${additionalInfo ? `
    <div style="margin: 20px 0;">
      <p><strong>Additional Information:</strong></p>
      <p>${additionalInfo.replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}

    <p>If you need to reschedule or cancel this appointment, please contact us as soon as possible.</p>

    <p>Thank you for choosing our service!</p>

    <p>Best regards,<br>${this.fromName}</p>
  </div>

  <div class="footer">
    This is an automated confirmation email. Please do not reply directly to this message.
  </div>
</body>
</html>
    `.trim();
  }

  private createConfirmationText(confirmation: EmailConfirmation): string {
    const { customerName, appointmentDetails, additionalInfo } = confirmation;
    const formattedStartTime = this.formatDateTime(appointmentDetails.startTime, appointmentDetails.timezone);
    const formattedEndTime = appointmentDetails.endTime
      ? this.formatDateTime(appointmentDetails.endTime, appointmentDetails.timezone)
      : null;

    let text = `Dear ${customerName},\n\n`;
    text += `Your appointment has been successfully confirmed!\n\n`;
    text += `APPOINTMENT DETAILS\n`;
    text += `===================\n\n`;
    text += `Service: ${appointmentDetails.eventType}\n`;
    text += `Date & Time: ${formattedStartTime}\n`;

    if (formattedEndTime) {
      text += `End Time: ${formattedEndTime}\n`;
    }

    if (appointmentDetails.location) {
      text += `Location: ${appointmentDetails.location}\n`;
    }

    if (additionalInfo) {
      text += `\nAdditional Information:\n${additionalInfo}\n`;
    }

    text += `\nIf you need to reschedule or cancel this appointment, please contact us as soon as possible.\n\n`;
    text += `Thank you for choosing our service!\n\n`;
    text += `Best regards,\n${this.fromName}\n\n`;
    text += `---\nThis is an automated confirmation email.`;

    return text;
  }

  private async sendAppointmentConfirmation(confirmation: EmailConfirmation) {
    try {
      const subject = confirmation.subject || `Appointment Confirmation - ${confirmation.appointmentDetails.eventType}`;

      const msg = {
        to: confirmation.to,
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        subject: subject,
        text: this.createConfirmationText(confirmation),
        html: this.createConfirmationHtml(confirmation),
      };

      const response = await sgMail.send(msg);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'sent',
              messageId: response[0].headers['x-message-id'],
              to: confirmation.to,
              subject: subject,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.errors
        ? JSON.stringify(error.response.body.errors)
        : error.message;
      throw new Error(`Failed to send appointment confirmation: ${errorMessage}`);
    }
  }

  private async sendAppointmentReminder(confirmation: EmailConfirmation) {
    try {
      const subject = confirmation.subject || `Reminder: Upcoming Appointment - ${confirmation.appointmentDetails.eventType}`;

      // Modify the confirmation for reminder context
      const reminderConfirmation = {
        ...confirmation,
        subject: subject,
      };

      // Create reminder-specific content
      let html = this.createConfirmationHtml(reminderConfirmation);
      html = html.replace('✓ Appointment Confirmed', '⏰ Appointment Reminder');
      html = html.replace('Your appointment has been successfully confirmed!', 'This is a friendly reminder about your upcoming appointment.');

      let text = this.createConfirmationText(reminderConfirmation);
      text = text.replace('Your appointment has been successfully confirmed!', 'This is a friendly reminder about your upcoming appointment.');

      const msg = {
        to: confirmation.to,
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        subject: subject,
        text: text,
        html: html,
      };

      const response = await sgMail.send(msg);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'sent',
              messageId: response[0].headers['x-message-id'],
              to: confirmation.to,
              subject: subject,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.errors
        ? JSON.stringify(error.response.body.errors)
        : error.message;
      throw new Error(`Failed to send appointment reminder: ${errorMessage}`);
    }
  }

  private async sendCustomEmail(args: any) {
    try {
      const msg = {
        to: args.to,
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        subject: args.subject,
        text: args.text,
        ...(args.html && { html: args.html }),
      };

      const response = await sgMail.send(msg);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'sent',
              messageId: response[0].headers['x-message-id'],
              to: args.to,
              subject: args.subject,
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = error.response?.body?.errors
        ? JSON.stringify(error.response.body.errors)
        : error.message;
      throw new Error(`Failed to send custom email: ${errorMessage}`);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Email MCP server running on stdio');
  }
}
