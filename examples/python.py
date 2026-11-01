import json
import os
import time
import urllib.request

base = os.getenv("SIMULATOR_URL", "http://localhost:3000")
api_key = os.getenv("SIMULATOR_API_KEY")
headers = {"Content-Type": "application/json"}
if api_key:
    headers["Authorization"] = f"Bearer {api_key}"

payload = json.dumps({
    "to": "+224612345678",
    "body": "Python integration test",
    "sender_id": "DEMO",
    "simulation": {"final_status": "delivered"},
}).encode()

request = urllib.request.Request(
    f"{base}/api/v1/messages",
    data=payload,
    headers=headers,
    method="POST",
)
with urllib.request.urlopen(request) as response:
    message = json.load(response)
print("accepted", message)

time.sleep(3)
status_request = urllib.request.Request(
    f"{base}{message['links']['self']}",
    headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
)
with urllib.request.urlopen(status_request) as response:
    print("final", json.load(response))
