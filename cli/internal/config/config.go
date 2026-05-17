package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Defaults holds default configuration values.
type Defaults struct {
	Platform string `yaml:"platform,omitempty"`
	Timeout  int    `yaml:"timeout,omitempty"`
	Format   string `yaml:"format,omitempty"`
}

// Config holds the CLI configuration.
type Config struct {
	ServerURL string   `yaml:"server_url,omitempty"`
	APIKey    string   `yaml:"api_key,omitempty"`
	Defaults  Defaults `yaml:"defaults,omitempty"`
}

// configPath returns the path to the config file.
func configPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".device-farm.yaml"
	}
	return filepath.Join(home, ".device-farm.yaml")
}

// Load reads the config file. Returns empty Config if file not found.
func Load() (*Config, error) {
	return LoadFrom(configPath())
}

// LoadFrom reads the config from a specific path.
func LoadFrom(path string) (*Config, error) {
	cfg := &Config{}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, fmt.Errorf("reading config: %w", err)
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return cfg, nil
}

// Save writes the config to the default path with 0600 permissions.
func (c *Config) Save() error {
	return c.SaveTo(configPath())
}

// SaveTo writes the config to a specific path with 0600 permissions.
func (c *Config) SaveTo(path string) error {
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("marshaling config: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}
	return nil
}

// Get returns a config value by dot-notation key.
func (c *Config) Get(key string) (string, error) {
	switch key {
	case "server_url":
		return c.ServerURL, nil
	case "api_key":
		return c.APIKey, nil
	case "defaults.platform":
		return c.Defaults.Platform, nil
	case "defaults.timeout":
		if c.Defaults.Timeout == 0 {
			return "", nil
		}
		return fmt.Sprintf("%d", c.Defaults.Timeout), nil
	case "defaults.format":
		return c.Defaults.Format, nil
	default:
		return "", fmt.Errorf("unknown config key: %s", key)
	}
}

// Set sets a config value by dot-notation key.
func (c *Config) Set(key, value string) error {
	switch key {
	case "server_url":
		c.ServerURL = value
	case "api_key":
		c.APIKey = value
	case "defaults.platform":
		c.Defaults.Platform = value
	case "defaults.timeout":
		var timeout int
		if _, err := fmt.Sscanf(value, "%d", &timeout); err != nil {
			return fmt.Errorf("invalid timeout value: %s", value)
		}
		c.Defaults.Timeout = timeout
	case "defaults.format":
		c.Defaults.Format = value
	default:
		return fmt.Errorf("unknown config key: %s", key)
	}
	return nil
}

// ListAll returns all config values as a map with API key masked.
func (c *Config) ListAll() map[string]string {
	m := map[string]string{
		"server_url":        c.ServerURL,
		"api_key":           maskAPIKey(c.APIKey),
		"defaults.platform": c.Defaults.Platform,
		"defaults.format":   c.Defaults.Format,
	}
	if c.Defaults.Timeout > 0 {
		m["defaults.timeout"] = fmt.Sprintf("%d", c.Defaults.Timeout)
	} else {
		m["defaults.timeout"] = ""
	}
	return m
}

// maskAPIKey masks all but the last 4 characters of the API key.
func maskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	return key[:strings.LastIndex(key, key[len(key)-4:])] + "***" + key[len(key)-4:]
}
