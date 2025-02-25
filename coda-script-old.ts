import * as coda from "@codahq/packs-sdk";

// ## Eventbrite API Types
interface EventbriteAttendee {
  id: string;
  profile: {
    first_name: string;
    last_name: string;
    email: string;
  };
  event_id: string;
  status: string;
  created: string;
  ticket_class_name: string;
}

interface AttendeesResponse {
  attendees: EventbriteAttendee[];
  pagination: {
    has_more_items: boolean;
    continuation?: string;
  };
}

interface UserResponse {
  name: string;
  emails: { email: string }[];
}

// ## Registration Schema
const registrationSchema = coda.makeObjectSchema({
  properties: {
    id: { type: coda.ValueType.String, description: "Attendee ID" },
    name: { type: coda.ValueType.String, description: "Attendee Name" },
    email: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.Email,
      description: "Attendee Email",
    },
    eventId: {
      type: coda.ValueType.String,
      description: "Eventbrite Event ID",
    },
    status: {
      type: coda.ValueType.String,
      description: "Registration Status (Attending, Cancelled, etc.)",
    },
    registered: {
      type: coda.ValueType.String, // ISO Date String
      codaType: coda.ValueHintType.DateTime,
      description: "Registration Date and Time",
    },
    ticket: {
      type: coda.ValueType.String,
      description: "Ticket Class Name",
    },
  },
  displayProperty: "name",
  idProperty: "id",
  featuredProperties: ["email", "status", "registered"],
});

// Define our Registration type for mapping rows.
type Registration = {
  id: string;
  name: string;
  email: string;
  eventId: string;
  status: string;
  registered: string;
  ticket: string;
};

// ## Pack Configuration
export const pack = coda.newPack();

// ## Authentication Setup
pack.setUserAuthentication({
  type: coda.AuthenticationType.OAuth2,
  authorizationUrl: "https://www.eventbrite.com/oauth/authorize",
  tokenUrl: "https://www.eventbrite.com/oauth/token",
  scopes: ["event_attendees:read", "user:read"],
  additionalParams: { response_type: "code" },
  getConnectionName: async (context: coda.ExecutionContext): Promise<string> => {
    try {
      console.log("Fetching connection name...");
      const response = await context.fetcher.fetch<UserResponse>({
        method: "GET",
        url: "https://www.eventbriteapi.com/v3/users/me/",
      });
      console.log("Connection name fetched successfully:", response.body.name);
      return response.body.name || "Eventbrite Account";
    } catch (error) {
      console.error("Error fetching connection name:", error);
      if (error instanceof coda.StatusCodeError) {
        throw new coda.UserVisibleError(
          `Eventbrite API error ${error.statusCode}: ${error.message}`
        );
      }
      throw new coda.UserVisibleError(
        `Failed to connect to Eventbrite: ${error.message || "Unknown error"}`
      );
    }
  },
});

pack.addNetworkDomain("eventbriteapi.com");

// ## Registrations Sync Table
pack.addSyncTable({
  name: "Registrations",
  identityName: "Registration",
  schema: registrationSchema,
  formula: {
    name: "SyncRegistrations",
    description: "Fetch Eventbrite registrations for a given event.",
    parameters: [
      coda.makeParameter({
        type: coda.ParameterType.String,
        name: "eventId",
        description:
          "Event ID or URL from Eventbrite (e.g., '1234567890' or full URL)",
      }),
    ],
    execute: async function (
      [eventId]: [string],
      context: coda.SyncExecutionContext
    ): Promise<coda.SyncFormulaResult<any, string, typeof registrationSchema>> {
      // Debug log the received eventId.
      console.log("Received eventId:", eventId);
      
      // Validate eventId: if not a pure numeric string, attempt to extract the numeric ID.
      if (!/^\d+$/.test(eventId)) {
        const match = eventId.match(/(\d+)/);
        if (match) {
          eventId = match[1];
          console.log("Extracted numeric eventId:", eventId);
        } else {
          throw new coda.UserVisibleError(
            `Invalid Event ID: "${eventId}". Ensure it is a numeric string or a valid Eventbrite event URL containing the event's numeric ID.`
          );
        }
      }
      // Build the URL using the eventId and any continuation token.
      let url = `https://www.eventbriteapi.com/v3/events/${eventId}/attendees/`;
      if (context.sync.continuation) {
        url += `?continuation=${encodeURIComponent(String(context.sync.continuation))}`;
      }
      // Fetch one page of results.
      const response = await context.fetcher.fetch<AttendeesResponse>({
        method: "GET",
        url: url,
      });
      const data = response.body;
      if (!data.pagination || !Array.isArray(data.attendees)) {
        throw new coda.UserVisibleError("Invalid API response format.");
      }
      // Map the API data to our Registration rows.
      const attendees: Registration[] = data.attendees.map((attendee) => ({
        id: attendee.id,
        name:
          [attendee.profile.first_name, attendee.profile.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || "Unnamed Attendee",
        email: attendee.profile.email,
        eventId: attendee.event_id,
        status: attendee.status,
        registered: new Date(attendee.created).toISOString(),
        ticket: attendee.ticket_class_name,
      }));
      return {
        result: attendees,
        continuation:
          data.pagination.has_more_items && data.pagination.continuation
            ? (data.pagination.continuation as any)
            : null,
      };
    },
  },
});

// ## Connection Test Formula
pack.addFormula({
  name: "TestConnection",
  description: "Verifies your connection to Eventbrite.",
  resultType: coda.ValueType.String,
  parameters: [],
  execute: async function (_: any[], context: coda.ExecutionContext) {
    try {
      console.log("Testing connection...");
      const response = await context.fetcher.fetch<UserResponse>({
        method: "GET",
        url: "https://www.eventbriteapi.com/v3/users/me/",
      });
      if (!response.body?.name) {
        throw new coda.UserVisibleError("Invalid user data: 'name' field missing.");
      }
      console.log("Connection test successful:", response.body.name);
      return `Successfully connected to Eventbrite as: ${response.body.name}`;
    } catch (error) {
      console.error("Error testing connection:", error);
      if (error instanceof coda.StatusCodeError) {
        throw new coda.UserVisibleError(
          `Eventbrite API error ${error.statusCode}: ${error.message}`
        );
      }
      throw new coda.UserVisibleError(`Connection test failed: ${error.message || "Unknown error"}`);
    }
  },
});
