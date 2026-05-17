package client

import (
	"context"
	"encoding/json"
	"fmt"
)

// ListDevices retrieves all devices from the server.
func (c *Client) ListDevices(ctx context.Context) ([]Device, error) {
	resp, err := c.Do(ctx, "GET", "/api/devices", nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var devices []Device
	if err := json.NewDecoder(resp.Body).Decode(&devices); err != nil {
		return nil, &ExitError{Code: 2, Message: fmt.Sprintf("decoding devices response: %v", err)}
	}
	return devices, nil
}
