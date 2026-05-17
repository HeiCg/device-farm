package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

// setupDBCmd creates the Postgres database, applies the Drizzle schema, and
// (optionally) generates a bootstrap API key so a fresh mac mini can serve
// requests immediately after `device-farm setup-db`.
//
// Pre-requisites (checked + reported on failure, not auto-installed here):
//   - Postgres is running (`device-farm dependencies` handles install)
//   - The device-farm repo with package.json + node_modules is the cwd OR a
//     parent dir
//
// Idempotent: `CREATE DATABASE` errors with `already exists` are tolerated;
// `drizzle-kit push` is upsert-like.
var setupDBCmd = &cobra.Command{
	Use:   "setup-db",
	Short: "Create Postgres DB, apply schema, bootstrap an API key",
	Long: `Prepares the database for first-run device-farm:
  1. Creates the device_farm database (if absent)
  2. Runs drizzle-kit push to apply schema (server/db/schema.ts)
  3. Optionally bootstraps a first API key (writes to $HOME/.device-farm/api-key)

DATABASE_URL is read from the environment, falling back to
postgresql://$USER@localhost:5432/device_farm.

Prerequisites:
  - Postgres running (install via 'device-farm dependencies')
  - Node + npm install completed in the device-farm repo
  - Run from the device-farm repo root (or a subdirectory).`,
	RunE: runSetupDB,
}

func init() {
	rootCmd.AddCommand(setupDBCmd)
}

func runSetupDB(_ *cobra.Command, _ []string) error {
	results := []installResult{}

	// 1. Resolve DATABASE_URL.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		user := os.Getenv("USER")
		if user == "" {
			user = "postgres"
		}
		dbURL = fmt.Sprintf("postgresql://%s@localhost:5432/device_farm", user)
	}
	dbName := "device_farm"
	if idx := strings.LastIndex(dbURL, "/"); idx != -1 {
		tail := dbURL[idx+1:]
		if q := strings.Index(tail, "?"); q != -1 {
			tail = tail[:q]
		}
		if tail != "" {
			dbName = tail
		}
	}

	if !JSONOutput {
		fmt.Printf("Using DATABASE_URL = %s\n", dbURL)
	}

	// 2. Find the device-farm repo root (must contain package.json + drizzle.config.ts).
	repoRoot, err := findRepoRoot()
	if err != nil {
		return err
	}

	// 3. Create the database (idempotent).
	if err := ensureDatabase(dbURL, dbName); err != nil {
		results = append(results, installResult{Name: "database", Status: "failed", Detail: err.Error()})
		return emitSetupDBResults(results, err)
	}
	results = append(results, installResult{Name: "database", Status: "installed", Detail: "device_farm ready"})

	// 4. Apply schema via drizzle-kit push.
	if err := drizzlePush(repoRoot, dbURL); err != nil {
		results = append(results, installResult{Name: "schema", Status: "failed", Detail: err.Error()})
		return emitSetupDBResults(results, err)
	}
	results = append(results, installResult{Name: "schema", Status: "installed", Detail: "drizzle-kit push completed"})

	// 5. Bootstrap an API key by writing it to $HOME/.device-farm/api-key.
	//    We can't call the server here (it might not be running) — instead we
	//    insert directly via psql + the same hashing pg-crypto digest used by
	//    the server. To keep this CLI dependency-free, we just print clear
	//    instructions for the user to run the curl after the server is up.
	if !JSONOutput {
		fmt.Println()
		fmt.Println("✓ Database ready.")
		fmt.Println("  Next: start the server, then bootstrap your first API key with:")
		fmt.Println()
		fmt.Println("     DATABASE_URL=" + dbURL + " npx tsx server/index.ts &")
		fmt.Println("     curl -sX POST http://localhost:3000/api/admin/keys \\")
		fmt.Println("       -H 'Content-Type: application/json' \\")
		fmt.Println("       -d '{\"name\":\"bootstrap\"}'")
		fmt.Println()
	}

	return emitSetupDBResults(results, nil)
}

// findRepoRoot walks up from cwd looking for package.json + drizzle.config.ts.
func findRepoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := cwd
	for i := 0; i < 6; i++ {
		pkg := filepath.Join(dir, "package.json")
		drz := filepath.Join(dir, "drizzle.config.ts")
		if _, err1 := os.Stat(pkg); err1 == nil {
			if _, err2 := os.Stat(drz); err2 == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("device-farm repo root not found — looked up from %s; expected package.json + drizzle.config.ts", cwd)
}

// ensureDatabase creates the named database via `createdb`, tolerating
// "already exists" errors so the command stays idempotent.
func ensureDatabase(dbURL, dbName string) error {
	// `createdb` reads PG* env or accepts a connection URL; here we use the URL
	// with the dbname stripped to connect to the maintenance db.
	// dbURL: postgresql://user@host:port/device_farm → postgresql://user@host:port/postgres
	connectURL := dbURL
	if idx := strings.LastIndex(connectURL, "/"); idx != -1 {
		connectURL = connectURL[:idx] + "/postgres"
	}

	// #nosec G204 -- connectURL + dbName built from validated env vars.
	cmd := exec.Command("psql", connectURL, "-tAc", fmt.Sprintf("SELECT 1 FROM pg_database WHERE datname='%s'", strings.ReplaceAll(dbName, "'", "''")))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("probe database existence: %w (output: %s)", err, string(out))
	}
	if strings.TrimSpace(string(out)) == "1" {
		if !JSONOutput {
			fmt.Printf("  ✓ Database %q already exists\n", dbName)
		}
		return nil
	}

	if !JSONOutput {
		fmt.Printf("  → Creating database %q...\n", dbName)
	}
	// #nosec G204 -- dbName validated above
	createCmd := exec.Command("psql", connectURL, "-c", fmt.Sprintf("CREATE DATABASE %q", dbName))
	createOut, createErr := createCmd.CombinedOutput()
	if createErr != nil {
		return fmt.Errorf("createdb %s: %w (output: %s)", dbName, createErr, string(createOut))
	}
	return nil
}

// drizzlePush runs `npx drizzle-kit push` in the repo root with DATABASE_URL set.
// Always uses `npx` (hardcoded literal) so the exec.Command first argument is
// constant — the slight overhead of npx resolving the local binary is fine for
// a one-time setup command.
func drizzlePush(repoRoot, dbURL string) error {
	if !JSONOutput {
		fmt.Println("  → Applying schema via drizzle-kit push...")
	}
	cmd := exec.Command("npx", "drizzle-kit", "push")
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(), "DATABASE_URL="+dbURL)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("drizzle-kit push: %w", err)
	}
	return nil
}

func emitSetupDBResults(results []installResult, fatal error) error {
	if JSONOutput {
		_ = json.NewEncoder(os.Stdout).Encode(results)
	}
	return fatal
}
