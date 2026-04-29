// PebbleTesla Pi server: public Funnel routes (OAuth callback + static public key)
// and tailnet-only APIs (OAuth poll, token ingest, Fleet reverse proxy).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type Config struct {
	PublicListen      string // e.g. ":8080" — expose via Tailscale Funnel for Tesla-only URLs
	TailnetListen     string // e.g. ":9000" — reachable only on tailnet (bind + ACLs)
	PublicCallbackPath string // registered as redirect_uri path on Funnel host
	PublicKeyPath     string // HTTP path to serve Tesla registration public key PEM
	PublicKeyFile     string // filesystem path to PEM file
	FleetAPIBase      string // e.g. https://fleet-api.prd.na.vn.cloud.tesla.com
	ProxyPrefix       string // mount Fleet proxy at this prefix (e.g. /proxy)
	SharedSecret      string // X-PebbleTesla-Secret header for tailnet APIs
	TokenFile         string // persisted OAuth tokens for proxy (restricted permissions)
}

type TokenBundle struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresAt    int64  `json:"expires_at"` // unix seconds
}

func loadConfig() Config {
	return Config{
		PublicListen:       getenv("PUBLIC_LISTEN", ":8080"),
		TailnetListen:      getenv("TAILNET_LISTEN", ":9000"),
		PublicCallbackPath: getenv("PUBLIC_CALLBACK_PATH", "/oauth/callback"),
		PublicKeyPath:      getenv("PUBLIC_KEY_PATH", "/.well-known/appspecific/com.tesla.3p.public-key.pem"),
		PublicKeyFile:      getenv("PUBLIC_KEY_FILE", ""),
		FleetAPIBase:       getenv("FLEET_API_BASE", "https://fleet-api.prd.na.vn.cloud.tesla.com"),
		ProxyPrefix:        getenv("PROXY_PREFIX", "/proxy"),
		SharedSecret:       os.Getenv("SHARED_SECRET"),
		TokenFile:          getenv("TOKEN_FILE", "tokens.json"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type Store struct {
	mu      sync.RWMutex
	tokens  TokenBundle
	pending map[string]string // oauth state -> authorization code
	fleetURL *url.URL
	tokenFile string
}

func main() {
	cfg := loadConfig()
	fleetURL, err := url.Parse(cfg.FleetAPIBase)
	if err != nil || fleetURL.Scheme == "" {
		log.Fatal("invalid FLEET_API_BASE")
	}

	st := &Store{
		pending:   make(map[string]string),
		fleetURL:  fleetURL,
		tokenFile: cfg.TokenFile,
	}
	_ = st.loadTokensFromDisk()

	ctx := context.Background()
	go func() { log.Fatal(runPublic(ctx, cfg, st)) }()
	log.Fatal(runTailnet(ctx, cfg, st))
}

func (st *Store) loadTokensFromDisk() error {
	b, err := os.ReadFile(st.tokenFile)
	if err != nil || len(b) == 0 {
		return err
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	return json.Unmarshal(b, &st.tokens)
}

func (st *Store) setTokens(b TokenBundle) error {
	st.mu.Lock()
	st.tokens = b
	st.mu.Unlock()
	return st.persistTokensToDisk()
}

func (st *Store) persistTokensToDisk() error {
	st.mu.RLock()
	data, err := json.MarshalIndent(st.tokens, "", "  ")
	st.mu.RUnlock()
	if err != nil {
		return err
	}
	tmp := st.tokenFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, st.tokenFile)
}

func requireTailnetSecret(cfg Config, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !requireSecret(w, r, cfg.SharedSecret) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireSecret(w http.ResponseWriter, r *http.Request, secret string) bool {
	if secret == "" {
		log.Print("warning: SHARED_SECRET empty — tailnet APIs are not authenticated")
		return true
	}
	if r.Header.Get("X-PebbleTesla-Secret") != secret {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func runPublic(ctx context.Context, cfg Config, st *Store) error {
	mux := http.NewServeMux()

	mux.HandleFunc(cfg.PublicCallbackPath, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		code := q.Get("code")
		state := q.Get("state")
		errParam := q.Get("error")
		if errParam != "" {
			http.Error(w, htmlEscape(errParam)+": "+htmlEscape(q.Get("error_description")), http.StatusBadRequest)
			return
		}
		if code != "" && state != "" {
			st.mu.Lock()
			st.pending[state] = code
			st.mu.Unlock()
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pebble Tesla</title></head><body>`)
		if code != "" && state != "" {
			fmt.Fprintf(w, `<p>Authorization received. You can return to the Pebble app on your phone.</p>`)
			fmt.Fprintf(w, `<p style="word-break:break-all;font-size:12px">state=%s</p>`, htmlEscape(state))
		} else {
			fmt.Fprintf(w, `<p>Missing code or state in redirect.</p>`)
		}
		fmt.Fprintf(w, `</body></html>`)
	})

	if cfg.PublicKeyFile != "" {
		mux.HandleFunc(cfg.PublicKeyPath, func(w http.ResponseWriter, r *http.Request) {
			b, err := os.ReadFile(cfg.PublicKeyFile)
			if err != nil {
				http.Error(w, "public key not configured", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/x-pem-file")
			_, _ = w.Write(b)
		})
	} else {
		log.Print("warning: PUBLIC_KEY_FILE unset — public key route returns 404")
		mux.HandleFunc(cfg.PublicKeyPath, func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "PUBLIC_KEY_FILE not set", http.StatusNotFound)
		})
	}

	srv := &http.Server{Addr: cfg.PublicListen, Handler: logging(mux)}
	go func() {
		<-ctx.Done()
		_ = srv.Shutdown(context.Background())
	}()
	log.Printf("public listener %s (Funnel — OAuth callback + public key only)", cfg.PublicListen)
	return srv.ListenAndServe()
}

func runTailnet(ctx context.Context, cfg Config, st *Store) error {
	mux := http.NewServeMux()

	mux.HandleFunc("/v1/oauth/poll", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if !requireSecret(w, r, cfg.SharedSecret) {
			return
		}
		state := r.URL.Query().Get("state")
		if state == "" {
			http.Error(w, "missing state", http.StatusBadRequest)
			return
		}
		st.mu.Lock()
		code, ok := st.pending[state]
		if ok {
			delete(st.pending, state)
		}
		st.mu.Unlock()
		if !ok {
			http.Error(w, "pending", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	})

	mux.HandleFunc("/v1/tokens", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		if !requireSecret(w, r, cfg.SharedSecret) {
			return
		}
		var b TokenBundle
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&b); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := st.setTokens(b); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	proxy := newFleetReverseProxy(st)
	private := http.StripPrefix(cfg.ProxyPrefix, proxy)
	mux.Handle(cfg.ProxyPrefix+"/", requireTailnetSecret(cfg, private))

	srv := &http.Server{Addr: cfg.TailnetListen, Handler: logging(mux)}
	go func() {
		<-ctx.Done()
		_ = srv.Shutdown(context.Background())
	}()
	log.Printf("tailnet listener %s (token ingest + Fleet proxy)", cfg.TailnetListen)
	return srv.ListenAndServe()
}

func newFleetReverseProxy(st *Store) http.Handler {
	director := func(req *http.Request) {
		st.mu.RLock()
		tok := st.tokens.AccessToken
		st.mu.RUnlock()

		target := st.fleetURL
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
	}

	return &httputil.ReverseProxy{
		Director: director,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   15 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("proxy error: %v", err)
			http.Error(w, err.Error(), http.StatusBadGateway)
		},
	}
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func htmlEscape(s string) string {
	return strings.NewReplacer(`&`, "&amp;", `<`, "&lt;", `>`, "&gt;", `"`, "&quot;").Replace(s)
}
