package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/hkjang/seaton/internal/platform"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	db       *pgxpool.Pool
	keys     *platform.Keyring
	logger   *slog.Logger
	webFS    fs.FS
	version  string
	commit   string
	builtAt  string
	analyses runningAnalyses
}

func NewServer(db *pgxpool.Pool, keys *platform.Keyring, logger *slog.Logger, webFS fs.FS, version, commit, builtAt string) *Server {
	return &Server{db: db, keys: keys, logger: logger, webFS: webFS, version: version, commit: commit, builtAt: builtAt}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, s.recoverer, s.securityHeaders, s.accessLog)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/readyz", s.ready)
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/version", s.versionInfo)
		r.Get("/auth/config", s.authConfig)
		r.Post("/auth/login", s.localLogin)
		r.Get("/auth/oidc/start", s.oidcStart)
		r.Get("/auth/oidc/callback", s.oidcCallback)
		r.Get("/openapi.json", s.openAPI)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Get("/auth/me", s.me)
			r.Post("/auth/logout", s.logout)
			r.Post("/auth/password", s.changePassword)
			r.Get("/buildings", s.listBuildings)
			r.Get("/floors", s.listFloors)
			r.Get("/floor-maps", s.listFloorMaps)
			r.Get("/floor-maps/{mapID}/content", s.mapContent)
			r.Get("/floor-maps/{mapID}/preview", s.mapPreview)
			r.Get("/seats", s.listSeats)
			r.Get("/employees", s.listEmployees)
			r.Get("/organizations", s.listOrganizations)
			r.Get("/seat-history", s.listHistory)
			r.Get("/api-keys", s.listAPIKeys)
			r.Post("/api-keys", s.createAPIKey)
			r.Post("/api-keys/{keyID}/rotate", s.rotateAPIKey)
			r.Delete("/api-keys/{keyID}", s.revokeAPIKey)
			r.Group(func(r chi.Router) {
				r.Use(s.requireSeatManager)
				r.Get("/dashboard", s.dashboard)
				r.Get("/dashboard/action-count", s.actionCount)
				r.Get("/dashboard/issues", s.dashboardIssues)
				r.Post("/dashboard/issues/{kind}/{issueID}/resolve", s.resolveDashboardIssue)
				r.Post("/dashboard/issues/retired-assignment/resolve-all", s.resolveAllRetiredAssignments)
				r.Post("/buildings", s.createBuilding)
				r.Post("/floors", s.createFloor)
				r.Post("/floor-maps", s.uploadFloorMap)
				r.Post("/floor-maps/{mapID}/analyze", s.analyzeFloorMap)
				r.Get("/analysis-jobs/{jobID}", s.analysisJobStatus)
				r.Post("/floor-maps/{mapID}/publish", s.publishFloorMap)
				r.Delete("/floor-maps/{mapID}", s.deleteFloorMap)
				r.Put("/floor-maps/{mapID}/grid", s.updateFloorMapGrid)
				r.Post("/floor-maps/{mapID}/seats/align", s.alignSeatsToGrid)
				r.Post("/seats", s.createSeat)
				r.Post("/seats/grid", s.createSeatGrid)
				r.Patch("/seats/bulk", s.updateSeatsBulk)
				r.Patch("/seats/{seatID}", s.updateSeat)
				r.Delete("/seats/{seatID}", s.deleteSeat)
				r.Post("/seat-assignments", s.assignSeat)
				r.Delete("/seat-assignments/{seatID}", s.unassignSeat)
				r.Post("/seat-assignments/bulk", s.bulkAssignments)
				r.Post("/employees", s.upsertEmployee)
				r.Post("/employees/import", s.importEmployees)
				r.Post("/organizations", s.upsertOrganization)
			})
			r.Group(func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/settings", s.listSettings)
				r.Put("/settings", s.updateSettings)
				r.Post("/settings/oidc/test", s.testOIDC)
				r.Post("/settings/hr/sync", s.syncEmployeesNow)
				r.Post("/settings/ai/vlm/test", s.testVLM)
				r.Get("/users", s.listUsers)
				r.Patch("/users/{userID}", s.updateUser)
			})
		})
	})
	r.With(s.authenticate).Post("/mcp", s.mcp)
	r.Handle("/*", s.spaHandler())
	return r
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds(), "request_id", middleware.GetReqID(r.Context()))
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.logger.Error("panic", "error", v, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal_error", "요청을 처리하지 못했습니다")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "데이터베이스 연결을 확인하세요")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) versionInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"name": "SeatOn", "version": s.version, "commit": s.commit, "builtAt": s.builtAt})
}

func (s *Server) spaHandler() http.Handler {
	assets := http.FileServer(http.FS(s.webFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/mcp" {
			http.NotFound(w, r)
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p != "." {
			if f, err := s.webFS.Open(p); err == nil {
				_ = f.Close()
				assets.ServeHTTP(w, r)
				return
			}
		}
		b, err := fs.ReadFile(s.webFS, "index.html")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "ui_unavailable", "UI 빌드가 포함되지 않았습니다")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "요청 형식을 확인하세요")
		return false
	}
	return true
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s", s[0:8], s[8:12], s[12:16], s[16:20], s[20:32])
}

func userFrom(r *http.Request) (User, bool) {
	u, ok := r.Context().Value(userContextKey).(User)
	return u, ok
}

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Email, &u.EmployeeID, &u.Role, &u.Source, &u.LastLoginAt)
	return u, err
}

func (s *Server) audit(ctx context.Context, userID, action, resourceType, resourceID, ip string, details any) {
	b, _ := json.Marshal(details)
	_, err := s.db.Exec(ctx, `INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, ip_address, details) VALUES(NULLIF($1,''),$2,$3,NULLIF($4,''),$5,$6)`, userID, action, resourceType, resourceID, ip, b)
	if err != nil {
		s.logger.Error("audit log failed", "error", err, "action", action)
	}
}

func notFoundOrServer(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "대상을 찾을 수 없습니다")
		return
	}
	writeError(w, http.StatusInternalServerError, "database_error", "데이터를 처리하지 못했습니다")
}
