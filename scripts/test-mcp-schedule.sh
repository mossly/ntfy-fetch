#!/bin/bash
# Test MCP schedule_notification tool for timeout behavior

MCP_URL="http://mossnas:12008/metamcp/mossnas/mcp"
HEADERS=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

# Calculate target time (1 minute from now in UTC ISO format)
TARGET_TIME=$(date -u -d '+1 minute' '+%Y-%m-%dT%H:%M:%S.000Z')

echo "=== Testing MCP schedule_notification tool ==="
echo "Scheduling notification for: $TARGET_TIME"
echo ""

# Create a temporary file to store cookies/session
COOKIE_FILE=$(mktemp)

# Initialize the connection
echo "1. Initializing MCP connection..."
INIT_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$MCP_URL" \
  "${HEADERS[@]}" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }')
echo "$INIT_RESPONSE" | grep -o '"serverInfo":[^}]*}' || echo "$INIT_RESPONSE"
echo ""

# Send initialized notification
echo "2. Sending initialized notification..."
curl -s -b "$COOKIE_FILE" -c "$COOKIE_FILE" -X POST "$MCP_URL" \
  "${HEADERS[@]}" \
  -d '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  }' > /dev/null
echo "Done"
echo ""

# Call the schedule_notification tool
echo "3. Calling schedule_notification tool..."
echo "   (Testing for timeout behavior - max wait 30 seconds)"
SCHEDULE_RESPONSE=$(timeout 30 curl -s -b "$COOKIE_FILE" -X POST "$MCP_URL" \
  "${HEADERS[@]}" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 2,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"schedule_notification\",
      \"arguments\": {
        \"title\": \"MCP Timeout Test\",
        \"message\": \"Testing if MCP schedule_notification times out\",
        \"scheduledFor\": \"$TARGET_TIME\"
      }
    }
  }")

TIMEOUT_EXIT=$?
echo ""

if [ $TIMEOUT_EXIT -eq 124 ]; then
  echo "❌ TIMEOUT: MCP call took more than 30 seconds"
  echo ""
  echo "This confirms the timeout issue that needs to be fixed."
else
  echo "✓ Response received within 30 seconds"
  echo ""
  echo "Response:"
  echo "$SCHEDULE_RESPONSE" | jq . 2>/dev/null || echo "$SCHEDULE_RESPONSE"

  # Check if it was successful
  if echo "$SCHEDULE_RESPONSE" | grep -q '"success":true'; then
    echo ""
    echo "✓ Notification scheduled successfully"
    echo "   Will be sent at: $TARGET_TIME"

    # Extract eventId if present
    EVENT_ID=$(echo "$SCHEDULE_RESPONSE" | jq -r '.result.content[0].text' 2>/dev/null | jq -r '.eventId' 2>/dev/null)
    if [ ! -z "$EVENT_ID" ] && [ "$EVENT_ID" != "null" ]; then
      echo "   Event ID: $EVENT_ID"
    fi
  elif echo "$SCHEDULE_RESPONSE" | grep -q '"error"'; then
    echo ""
    echo "❌ Error occurred:"
    echo "$SCHEDULE_RESPONSE" | jq -r '.error.message' 2>/dev/null || echo "$SCHEDULE_RESPONSE"
  fi
fi

# Cleanup
rm -f "$COOKIE_FILE"

echo ""
echo "=== Test Complete ==="
