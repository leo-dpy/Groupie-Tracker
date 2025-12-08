# Groupie-Tracker

Display band/artist information with **Go backend** processing all data from external API.

## Quick Start

```powershell
# Start server (basic version)
go run .

# With YouTube videos (optional)
$env:YT_API_KEY = "YOUR_KEY"; go run .
```

Open: `http://localhost:8080`

---

## Architecture

```
External API → Go Backend (fetch + combine + filter) → JSON → JavaScript (render UI)
```

**Go Backend (`main.go`):**
- ✅ Fetches 4 API parts: artists, locations, dates, relation
- ✅ Combines data server-side
- ✅ Server-side search/filtering
- ✅ Caching (5min TTL)

**JavaScript (`js/*.js`):**
- ✅ Renders UI only (no data manipulation)
- ✅ Calls Go endpoints: `/api/combined`, `/api/search`, `/api/artist/:id`

---

## API Endpoints (Go Backend)

| Endpoint | Description |
|----------|-------------|
| `GET /api/combined` | All artists with shows combined |
| `GET /api/search?q=term` | Server-side search by name/member |
| `GET /api/artist/:id` | Single artist with concerts |
| `GET /yt/search?q=term` | YouTube proxy (optional) |

---

## Example Server Logs (Proof)

```
2025/11/25 11:02:25 Serving on http://localhost:8080
2025/11/25 11:02:28 GET /api/combined 265ms     ← Go combines artists+shows
2025/11/25 11:02:30 GET /api/artist/1 2.7ms     ← Go serves single artist
2025/11/25 11:03:21 GET /api/combined 2.2ms     ← Served from cache
```

**Flow:** Browser JS → Go endpoint → Go processes data → Returns JSON → JS renders

---

## Project Structure

```
main.go              # Go server + all data logic
handlers_test.go     # Unit tests (go test -v ./...)
html/                # HTML templates
js/                  # JavaScript (UI rendering only)
  ├── app.js         # Homepage: calls /api/combined
  ├── details.js     # Details: calls /api/artist/:id
  ├── library.js     # Playlists (localStorage)
  └── toast.js       # Notifications
css/styles.css       # Styling
```

---

## Requirements Compliance ✅

✅ **Backend in Go** - All data manipulation in `main.go`  
✅ **4 API parts** - artists + locations + dates + relation  
✅ **Client-server** - Search, details, YouTube triggers Go endpoints  
✅ **No crashes** - Error handling everywhere  
✅ **Standard library** - Zero external Go packages  
✅ **Unit tests** - `handlers_test.go` included  
✅ **Good practices** - Caching, concurrency, logging

## Author

**Léo Dupuy** (@leo-dpy)  
Email: leo.dupuy@ynov.com

