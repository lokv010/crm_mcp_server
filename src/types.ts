export interface CustomerRecord {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  issue: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt?: string;
  updatedAt?: string;
  notes?: string;
}

export interface AppointmentDetails {
  name: string;
  email: string;
  eventType: string;
  startTime?: string;
  timezone?: string;
  notes?: string;
}

export interface CalendlyEvent {
  uri: string;
  name: string;
  scheduling_url: string;
  duration: number;
  active: boolean;
}

export interface EmailConfirmation {
  to: string;
  subject: string;
  customerName: string;
  appointmentDetails: {
    eventType: string;
    startTime: string;
    endTime?: string;
    timezone: string;
    location?: string;
  };
  additionalInfo?: string;
}

export interface EmailStatus {
  messageId: string;
  to: string;
  status: 'sent' | 'failed';
  timestamp: string;
  error?: string;
}
