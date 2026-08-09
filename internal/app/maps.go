package app

import (
	"bytes"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (s *Server) listBuildings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT id,name,code,COALESCE(address,'') FROM buildings ORDER BY name`)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, code, address string
		if rows.Scan(&id, &name, &code, &address) == nil {
			items = append(items, map[string]any{"id": id, "name": name, "code": code, "address": address})
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) createBuilding(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string `json:"name"`
		Code    string `json:"code"`
		Address string `json:"address"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if in.Name == "" || in.Code == "" {
		writeError(w, 400, "required_fields", "건물명과 코드는 필수입니다")
		return
	}
	id := newID()
	_, err := s.db.Exec(r.Context(), `INSERT INTO buildings(id,name,code,address) VALUES($1,$2,$3,NULLIF($4,''))`, id, in.Name, in.Code, in.Address)
	if err != nil {
		writeError(w, 409, "building_conflict", "이미 사용 중인 건물 코드입니다")
		return
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "building.create", "building", id, r.RemoteAddr, in)
	writeJSON(w, 201, map[string]string{"id": id})
}

func (s *Server) listFloors(w http.ResponseWriter, r *http.Request) {
	buildingID := r.URL.Query().Get("buildingId")
	rows, err := s.db.Query(r.Context(), `SELECT f.id,f.building_id,f.name,f.code,f.sort_order,b.name FROM floors f JOIN buildings b ON b.id=f.building_id WHERE ($1='' OR f.building_id=$1) ORDER BY b.name,f.sort_order,f.name`, buildingID)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, bid, name, code, bname string
		var order int
		if rows.Scan(&id, &bid, &name, &code, &order, &bname) == nil {
			items = append(items, map[string]any{"id": id, "buildingId": bid, "buildingName": bname, "name": name, "code": code, "sortOrder": order})
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) createFloor(w http.ResponseWriter, r *http.Request) {
	var in struct {
		BuildingID string `json:"buildingId"`
		Name       string `json:"name"`
		Code       string `json:"code"`
		SortOrder  int    `json:"sortOrder"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	if in.BuildingID == "" || in.Name == "" || in.Code == "" {
		writeError(w, 400, "required_fields", "건물, 층 이름, 코드는 필수입니다")
		return
	}
	id := newID()
	_, err := s.db.Exec(r.Context(), `INSERT INTO floors(id,building_id,name,code,sort_order) VALUES($1,$2,$3,$4,$5)`, id, in.BuildingID, in.Name, in.Code, in.SortOrder)
	if err != nil {
		writeError(w, 409, "floor_conflict", "층 정보가 중복되었거나 건물이 없습니다")
		return
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "floor.create", "floor", id, r.RemoteAddr, in)
	writeJSON(w, 201, map[string]string{"id": id})
}

func (s *Server) listFloorMaps(w http.ResponseWriter, r *http.Request) {
	floorID := r.URL.Query().Get("floorId")
	rows, err := s.db.Query(r.Context(), `SELECT m.id,m.floor_id,m.version,m.file_name,m.content_type,m.width,m.height,m.status,m.is_active,m.created_at,f.name,b.name,stats.seat_count,stats.review_count
	FROM floor_maps m JOIN floors f ON f.id=m.floor_id JOIN buildings b ON b.id=f.building_id
	LEFT JOIN LATERAL (SELECT COUNT(*) seat_count,COUNT(*) FILTER(WHERE confidence IS NOT NULL AND confidence < .95) review_count FROM seats s WHERE s.floor_map_id=m.id) stats ON true
	WHERE ($1='' OR m.floor_id=$1) ORDER BY m.created_at DESC`, floorID)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, fid, version, name, ct, status, fname, bname string
		var width, height *int
		var active bool
		var seatCount, reviewCount int
		var created any
		if rows.Scan(&id, &fid, &version, &name, &ct, &width, &height, &status, &active, &created, &fname, &bname, &seatCount, &reviewCount) == nil {
			items = append(items, map[string]any{"id": id, "floorId": fid, "version": version, "fileName": name, "contentType": ct, "width": width, "height": height, "status": status, "active": active, "createdAt": created, "floorName": fname, "buildingName": bname, "seatCount": seatCount, "reviewCount": reviewCount, "contentUrl": "/api/v1/floor-maps/" + id + "/content"})
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) uploadFloorMap(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 30<<20)
	if err := r.ParseMultipartForm(30 << 20); err != nil {
		writeError(w, 400, "upload_too_large", "도면 파일은 25MB 이하여야 합니다")
		return
	}
	floorID := strings.TrimSpace(r.FormValue("floorId"))
	version := strings.TrimSpace(r.FormValue("version"))
	file, header, err := r.FormFile("file")
	if err != nil || floorID == "" || version == "" {
		writeError(w, 400, "required_fields", "층, 버전, 도면 파일은 필수입니다")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 25<<20+1))
	if err != nil || len(data) > 25<<20 {
		writeError(w, 400, "upload_too_large", "도면 파일은 25MB 이하여야 합니다")
		return
	}
	ct := http.DetectContentType(data)
	allowed := map[string]bool{"image/png": true, "image/jpeg": true, "application/pdf": true}
	if !allowed[ct] {
		writeError(w, 400, "unsupported_map", "PNG, JPG, PDF 도면만 업로드할 수 있습니다")
		return
	}
	var width, height *int
	if strings.HasPrefix(ct, "image/") {
		if cfg, _, e := image.DecodeConfig(bytes.NewReader(data)); e == nil {
			width = &cfg.Width
			height = &cfg.Height
		}
	}
	id := newID()
	u, _ := userFrom(r)
	_, err = s.db.Exec(r.Context(), `INSERT INTO floor_maps(id,floor_id,version,file_name,content_type,file_data,width,height,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, floorID, version, safeFilename(header), ct, data, width, height, u.ID)
	if err != nil {
		writeError(w, 409, "map_conflict", "동일한 층과 버전의 도면이 이미 있습니다")
		return
	}
	s.audit(r.Context(), u.ID, "floor_map.upload", "floor_map", id, r.RemoteAddr, map[string]any{"file": header.Filename, "size": len(data)})
	writeJSON(w, 201, map[string]string{"id": id})
}

func safeFilename(h *multipart.FileHeader) string {
	name := strings.ReplaceAll(h.Filename, "\\", "/")
	parts := strings.Split(name, "/")
	return parts[len(parts)-1]
}

func (s *Server) mapContent(w http.ResponseWriter, r *http.Request) {
	var data []byte
	var ct, name string
	err := s.db.QueryRow(r.Context(), `SELECT file_data,content_type,file_name FROM floor_maps WHERE id=$1`, chi.URLParam(r, "mapID")).Scan(&data, &ct, &name)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(name, `"`, "")+`"`)
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(data)
}

func (s *Server) publishFloorMap(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "mapID")
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var floorID string
	if err = tx.QueryRow(r.Context(), `SELECT floor_id FROM floor_maps WHERE id=$1`, id).Scan(&floorID); err != nil {
		notFoundOrServer(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE floor_maps SET is_active=false,status=CASE WHEN status='published' THEN 'archived' ELSE status END WHERE floor_id=$1`, floorID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE floor_maps SET is_active=true,status='published',published_at=now() WHERE id=$1`, id)
	}
	if err != nil || tx.Commit(r.Context()) != nil {
		notFoundOrServer(w, err)
		return
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "floor_map.publish", "floor_map", id, r.RemoteAddr, nil)
	w.WriteHeader(204)
}

func parseFloat(s string, fallback float64) float64 {
	v, e := strconv.ParseFloat(s, 64)
	if e != nil {
		return fallback
	}
	return v
}
