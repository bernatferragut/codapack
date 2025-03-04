import * as coda from "@codahq/packs-sdk";

export const pack = coda.newPack();

// -------------------------------
// Authentication Setup
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
// Schema and Row Type for Events
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
// Formula to List Organizations
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
// Events Sync Table (with Organization ID Parameter)
// -------------------------------
// In JavaScript we don’t specify generic types.
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
