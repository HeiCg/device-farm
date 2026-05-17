package client

// Job represents a test job from the server API.
type Job struct {
	ID            string         `json:"id"`
	Status        string         `json:"status"`
	Platform      string         `json:"platform"`
	CreatedAt     string         `json:"createdAt"`
	StartedAt     *string        `json:"startedAt"`
	FinishedAt    *string        `json:"finishedAt"`
	Metadata      map[string]any `json:"metadata"`
	ResultSummary map[string]any `json:"resultSummary"`
	Steps         []JobStep      `json:"steps"`
	DeviceName    *string        `json:"deviceName"`
	DeviceId      *string        `json:"deviceId"`
	MaestroOutput *string        `json:"maestroOutput"`
	ErrorMessage  *string        `json:"errorMessage"`
}

// JobStep represents a single step in a test job.
type JobStep struct {
	FlowName   string  `json:"flowName"`
	Command    *string `json:"command"`
	Status     string  `json:"status"`
	DurationMs *int    `json:"durationMs"`
	StepIndex  int     `json:"stepIndex"`
}

// Device represents a device in the pool.
type Device struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Platform     string  `json:"platform"`
	State        string  `json:"state"`
	EmulatorID   string  `json:"emulatorId"`
	CurrentJobID *string `json:"currentJobId"`
	Port         *int    `json:"port"`
	Pid          *int    `json:"pid"`
}

// JobListResponse represents a paginated list of jobs.
type JobListResponse struct {
	Data    []Job  `json:"data"`
	Cursor  string `json:"cursor"`
	HasMore bool   `json:"hasMore"`
}

// ListJobsParams holds query parameters for listing jobs.
type ListJobsParams struct {
	Cursor   string
	Status   string
	Platform string
	Limit    int
}

// CancelResponse represents the server response to a cancel request.
type CancelResponse struct {
	Status string `json:"status"`
}
