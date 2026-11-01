const baseUrl = process.env.SIMULATOR_URL || "http://localhost:3000";
const apiKey = process.env.SIMULATOR_API_KEY;
const headers = { "content-type": "application/json" };
if (apiKey) headers.authorization = `Bearer ${apiKey}`;

const response = await fetch(`${baseUrl}/api/v1/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    to: "+224612345678",
    body: "Node.js integration test",
    sender_id: "DEMO",
    simulation: { final_status: "delivered" }
  }),
});

if (!response.ok) {
  throw new Error(`Simulator request failed: HTTP ${response.status}`);
}
const message = await response.json();
console.log("accepted", message);

await new Promise((resolve) => setTimeout(resolve, 3000));
const statusResponse = await fetch(`${baseUrl}${message.links.self}`, {
  headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
});
if (!statusResponse.ok) {
  throw new Error(`Simulator status request failed: HTTP ${statusResponse.status}`);
}
console.log("final", await statusResponse.json());
