import * as coda from "@codahq/packs-sdk";

export const pack = coda.newPack();

// -------------------------------
// Authentication Setup (No changes needed here)
// -------------------------------
pack.setUserAuthentication({
  type: coda.AuthenticationType.OAuth2,
  authorizationUrl: "https://www.eventbrite.com/oauth/authorize",
  tokenUrl: "https://www.eventbrite.com/oauth/token",
  scopes: ["user", "event"],
  additionalParams: { response_type: "code" },
  getConnectionName: async function (context) {
    const res = await context.fetcher.fetch({
      method: "GET",
      url: "https://www.eventbriteapi.com/v3/users/me/",
    });
    return (res.body.name || "Eventbrite Account");
  },
});

pack.addNetworkDomain("eventbriteapi.com");

// -------------------------------
// Schema and Row Type for Events (No changes needed here)
// -------------------------------
const eventSchema = coda.makeObjectSchema({
  properties: {
    id: { type: coda.ValueType.String, description: "Event ID" },
    name: { type: coda.ValueType.String, description: "Event Name" },
    url: { type: coda.ValueType.String, description: "Event URL" },
    start: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.DateTime,
      description: "Start Date/Time",
    },
    end: {
      type: coda.ValueType.String,
      codaType: coda.ValueHintType.DateTime,
      description: "End Date/Time",
    },
  },
  displayProperty: "name",
  idProperty: "id",
});

// -------------------------------
// Schema and Row Type for Attendees
// -------------------------------
const attendeeSchema = coda.makeObjectSchema({
  properties: {
    id: { type: coda.ValueType.String, description: "Attendee ID" },
    name: { type: coda.ValueType.String, description: "Attendee Name" },
    email: { type: coda.ValueType.String, description: "Attendee Email" },
    ticketClass: { type: coda.ValueType.String, description: "Ticket Class" },
    // You can add more attendee details here as needed,
    // refer to Eventbrite API documentation for available fields.
  },
  displayProperty: "name",
  idProperty: "id",
});

// -------------------------------
// Formula to List Organizations (No changes needed here)
// -------------------------------
pack.addFormula({
  name: "ListOrganizations",
  description: "List the organizations the user belongs to.",
  parameters: [],
  resultType: coda.ValueType.Array,
  items: coda.makeSchema({
    type: coda.ValueType.Object,
    properties: {
      id: { type: coda.ValueType.String },
      name: { type: coda.ValueType.String },
    },
  }),
  execute: async function (_params, context) {
    const res = await context.fetcher.fetch({
      method: "GET",
      url: "https://www.eventbriteapi.com/v3/users/me/organizations/",
    });
    const data = res.body;
    if (!data.organizations || !Array.isArray(data.organizations)) {
      throw new coda.UserVisibleError("Invalid API response format.");
    }
    return data.organizations.map(org => ({ id: org.id, name: org.name }));
  },
});

// -------------------------------
// Formula to List Attendees for an Event
// -------------------------------
pack.addFormula({
  name: "ListAttendeesForEvent",
  description: "List the attendees for a specific Eventbrite event.",
  parameters: [
    coda.makeParameter({
      type: coda.ParameterType.String,
      name: "eventId",
      description: "The ID of the event to fetch attendees from.",
    }),
  ],
  resultType: coda.ValueType.Array,
  items: attendeeSchema, // Use the attendeeSchema we defined
  execute: async function ([eventId], context) {
    if (!eventId) {
      throw new coda.UserVisibleError("Event ID is required.");
    }

    let url = `https://www.eventbriteapi.com/v3/events/${eventId}/attendees/`;
    let attendees = [];
    let continuation: string | undefined = undefined;

    do {
      if (continuation) {
        url += `?continuation=${encodeURIComponent(continuation)}`;
      }

      const attendeesRes = await context.fetcher.fetch({
        method: "GET",
        url: url,
      });
      const data = attendeesRes.body;

      if (!data.attendees || !Array.isArray(data.attendees)) {
        throw new coda.UserVisibleError("Invalid API response format for attendees.");
      }

      attendees = attendees.concat(data.attendees.map(attendee => ({
        id: String(attendee.id),
        name: attendee.profile.name,
        email: attendee.profile.email,
        ticketClass: attendee.ticket_class_name,
        // Map other attendee fields from the API response to your schema as needed.
      })));

      continuation = data.pagination.has_more_items ? data.pagination.continuation : undefined;
    } while (continuation); // Continue fetching pages as long as there's a continuation token

    return attendees;
  },
});


// -------------------------------
// Events Sync Table (with Organization ID Parameter) (No changes needed here)
// -------------------------------
pack.addSyncTable({
  name: "Events",
  identityName: "Event",
  schema: eventSchema,
  formula: {
    name: "SyncEvents",
    description: "Fetch all Eventbrite events for the specified organization.",
    parameters: [
      coda.makeParameter({
        type: coda.ParameterType.String,
        name: "organizationId",
        description: "The ID of the organization to fetch events from.",
      }),
    ],
    execute: async function ([organizationId], context) {
      if (!organizationId) {
        throw new coda.UserVisibleError("Organization ID is required.");
      }

      let url = `https://www.eventbriteapi.com/v3/organizations/${organizationId}/events/`;
      if (context.sync.continuation) {
        url += `?continuation=${encodeURIComponent(String(context.sync.continuation))}`;
      }

      const eventsRes = await context.fetcher.fetch({
        method: "GET",
        url: url,
      });
      const data = eventsRes.body;
      if (!data.pagination || !Array.isArray(data.events)) {
        throw new coda.UserVisibleError("Invalid API response format.");
      }

      const rows = data.events.map(ev => ({
        id: String(ev.id),
        name: ev.name.text || "Unnamed Event",
        url: ev.url,
        start: ev.start.utc,
        end: ev.end.utc,
      }));

      return {
        result: rows,
        continuation: data.pagination.has_more_items && data.pagination.continuation
          ? data.pagination.continuation
          : undefined,
      };
    },
  },
});

//  version 2.0  - The one that fetches the organization ID and Attendeess