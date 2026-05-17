package config

import "os"

// ResolveServerURL returns the server URL with priority: flag > env > config > default.
func ResolveServerURL(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if env := os.Getenv("DEVICE_FARM_URL"); env != "" {
		return env
	}
	cfg, err := Load()
	if err == nil && cfg.ServerURL != "" {
		return cfg.ServerURL
	}
	return "http://localhost:3000"
}

// ResolveAPIKey returns the API key with priority: flag > env > config > "".
func ResolveAPIKey(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if env := os.Getenv("DEVICE_FARM_API_KEY"); env != "" {
		return env
	}
	cfg, err := Load()
	if err == nil && cfg.APIKey != "" {
		return cfg.APIKey
	}
	return ""
}

// ResolvePlatform returns the platform with priority: flag > env > config > "".
func ResolvePlatform(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if env := os.Getenv("DEVICE_FARM_PLATFORM"); env != "" {
		return env
	}
	cfg, err := Load()
	if err == nil && cfg.Defaults.Platform != "" {
		return cfg.Defaults.Platform
	}
	return ""
}
