# CODA PACK PLUGIN - EVENTBRITE

Typescript plugin to connect the Eventbrite Workshop inscriptions to the CODA App.

__Examples Test Code__ 

```
import { pack } from "./coda-script";

async function testConnection() {
  try {
    console.log("Starting connection test...");
    const context = {
      fetcher: {
        fetch: async (request: any) => {
          // Simulate the fetcher behavior for testing purposes
          console.log("Fetching URL:", request.url);
          // Replace this with actual fetch logic if needed
          return {
            body: {
              name: "Test User",
            },
          };
        },
      },
    };

    const result = await pack.formulas.TestConnection.execute([], context);
    console.log("Connection test result:", result);
  } catch (error) {
    console.error("Error during connection test:", error);
  }
}

testConnection();
```
