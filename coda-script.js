import * as coda from "@codahq/packs-sdk";
// ======================
// Pack Configuration
// ======================
export const pack = coda.newPack();
// ======================
// Authentication Setup
// ======================
pack.setUserAuthentication({
    type: coda.AuthenticationType.OAuth2,
    authorizationUrl: "https://www.eventbrite.com/oauth/authorize",
    tokenUrl: "https://www.eventbrite.com/oauth/token",
    scopes: ["event_attendees:read", "user:read"],
    additionalParams: { response_type: "code" },
    getConnectionName: async (context) => {
        try {
            const response = await context.fetcher.fetch({
                method: "GET",
                url: "https://www.eventbriteapi.com/v3/users/me/",
            });
            if (response.status >= 400) {
                let errorMessage = `Eventbrite API error ${response.status}`;
                if (response.body?.error_description) {
                    errorMessage += `: ${response.body.error_description}`;
                }
                throw new coda.UserVisibleError(errorMessage);
            }
            // Use the user's name from the Eventbrite profile for connection name
            return response.body.name || "Eventbrite Account";
        }
        catch (error) {
            if (error instanceof coda.UserVisibleError) {
                throw error; // Re-throw UserVisibleErrors directly
            }
            // Handle generic errors (network issues, etc.)
            throw new coda.UserVisibleError(`Failed to connect to Eventbrite: ${error.message || 'Unknown error'}`);
        }
    },
});
pack.addNetworkDomain("eventbriteapi.com");
// ======================
// Registrations Sync Table
// ======================
pack.addSyncTable({
    name: "Registrations",
    identityName: "Registration",
    schema: coda.makeObjectSchema({
        properties: {
            id: { type: coda.ValueType.String, description: "Attendee ID" },
            name: { type: coda.ValueType.String, description: "Attendee Name" },
            email: {
                type: coda.ValueType.String,
                codaType: coda.ValueHintType.Email,
                description: "Attendee Email"
            },
            eventId: {
                type: coda.ValueType.String,
                description: "Eventbrite Event ID"
            },
            status: {
                type: coda.ValueType.String,
                description: "Registration Status (Attending, Cancelled, etc.)"
            },
            registered: {
                type: coda.ValueType.String, // ISO Date String
                codaType: coda.ValueHintType.DateTime,
                description: "Registration Date and Time"
            },
            ticket: {
                type: coda.ValueType.String,
                description: "Ticket Class Name"
            },
        },
        displayProperty: "name",
        idProperty: "id",
        featuredProperties: ["email", "status", "registered"]
    }),
    formula: {
        name: "SyncRegistrations",
        description: "Fetch Eventbrite registrations for a given event.",
        parameters: [
            coda.makeParameter({
                type: coda.ParameterType.String,
                name: "eventId",
                description: "Event ID from Eventbrite URL (e.g., '1234567890')"
            })
        ],
        execute: async function ([eventId], context) {
            const baseUrl = `https://www.eventbriteapi.com/v3/events/${eventId}/attendees/`;
            const attendees = [];
            let continuation;
            let hasMore = true;
            let retryCount = 0;
            const maxRetries = 3; // Maximum retry attempts for rate limiting
            while (hasMore) {
                const url = new URL(baseUrl);
                if (continuation) {
                    url.searchParams.set("continuation", continuation);
                }
                try {
                    const response = await context.fetcher.fetch({
                        method: "GET",
                        url: url.toString(),
                    });
                    if (response.status === 429) { // Rate Limit Handling
                        if (retryCount < maxRetries) {
                            retryCount++;
                            // Eventbrite returns Retry-After header to indicate how long to wait
                            const retryAfterValue = response.headers?.["retry-after"];
                            const retryAfterSeconds = parseInt(String(retryAfterValue || "5"), 10); // Default to 5 seconds if header is missing or invalid
                            context.logger?.warn(`Eventbrite API rate limit hit. Retrying in ${retryAfterSeconds} seconds (Retry ${retryCount}/${maxRetries}).`);
                            await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000));
                            continue; // Retry the request
                        }
                        else {
                            throw new coda.UserVisibleError("Eventbrite API rate limit exceeded after multiple retries. Please try again later.");
                        }
                    }
                    else if (response.status >= 400) {
                        let errorMessage = `Eventbrite API error ${response.status}`;
                        if (response.body?.error_description) {
                            errorMessage += `: ${response.body.error_description}`;
                        }
                        throw new coda.UserVisibleError(errorMessage);
                    }
                    // Validate response structure to ensure expected data format
                    if (!response.body?.pagination) {
                        throw new coda.UserVisibleError("Invalid API response format: Missing pagination information.");
                    }
                    if (!Array.isArray(response.body.attendees)) {
                        throw new coda.UserVisibleError("Invalid API response format: Attendees data is not an array.");
                    }
                    attendees.push(...response.body.attendees);
                    hasMore = response.body.pagination.has_more_items;
                    continuation = response.body.pagination.continuation;
                    // Safety check for infinite loop if API indicates more items but no continuation token
                    if (hasMore && !continuation) {
                        context.logger?.warn("Eventbrite API indicates more items but provided no continuation token. Halting sync to prevent infinite loop.");
                        break;
                    }
                }
                catch (error) {
                    if (error instanceof coda.UserVisibleError) {
                        throw error; // Re-throw UserVisibleErrors directly
                    }
                    // Handle generic errors during API call
                    throw new coda.UserVisibleError(`Error fetching registrations from Eventbrite: ${error.message || 'Unknown error'}`);
                }
            }
            return {
                result: attendees.map(attendee => ({
                    id: attendee.id,
                    name: `${attendee.profile.first_name} ${attendee.profile.last_name}`.trim(), // Construct full name and trim whitespace
                    email: attendee.profile.email,
                    eventId: attendee.event_id,
                    status: attendee.status,
                    registered: new Date(attendee.created).toISOString(), // Convert Eventbrite timestamp to ISO string for Coda DateTime
                    ticket: attendee.ticket_class_name,
                })),
            };
        }
    }
});
// ======================
// Connection Test Formula
// ======================
pack.addFormula({
    name: "TestConnection",
    description: "Verifies your connection to Eventbrite.",
    resultType: coda.ValueType.String,
    parameters: [],
    execute: async function (_, context) {
        try {
            const response = await context.fetcher.fetch({
                method: "GET",
                url: "https://www.eventbriteapi.com/v3/users/me/",
            });
            if (response.status >= 400) {
                let errorMessage = `Eventbrite API error ${response.status}`;
                if (response.body?.error_description) {
                    errorMessage += `: ${response.body.error_description}`;
                }
                throw new coda.UserVisibleError(errorMessage);
            }
            if (!response.body || typeof response.body.name !== "string") {
                throw new coda.UserVisibleError("Invalid user data format received from Eventbrite: 'name' field is missing or not a string.");
            }
            return `Successfully connected to Eventbrite as: ${response.body?.name}`;
        }
        catch (error) {
            if (error instanceof coda.UserVisibleError) {
                throw error; // Re-throw UserVisibleErrors directly
            }
            // Handle generic connection test errors
            throw new coda.UserVisibleError(`Failed to test connection to Eventbrite: ${error.message || 'Unknown error'}`);
        }
    }
});
