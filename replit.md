# Euro Parking Services - AI-Powered Parking Enforcement System

## Overview
A comprehensive parking enforcement system for Euro Parking Services featuring AI-powered violation detection, ANPR (Automatic Number Plate Recognition), and PCN (Penalty Charge Notice) management.

## Tech Stack
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-4.1 (via Replit AI Integrations)
- **Authentication**: JWT with bcrypt password hashing

## Default Credentials
- **Username**: admin
- **Password**: admin123

## Project Structure
```
├── client/                  # React frontend
│   ├── src/
│   │   ├── components/      # UI components
│   │   ├── pages/           # Page components
│   │   └── lib/             # Utilities (auth, theme, query client)
├── server/                  # Express backend
│   ├── auth.ts              # JWT authentication
│   ├── routes.ts            # API endpoints
│   ├── storage.ts           # Database storage layer
│   └── ai-analysis.ts       # OpenAI violation analysis
├── shared/                  # Shared types
│   └── schema.ts            # Drizzle schema & types
└── uploads/                 # Evidence file uploads
```

## Key Features
1. **Role-Based Access Control**
   - Admin: Full system access
   - Operator: Evidence/camera management
   - Enforcement Officer: Review-only access

2. **Evidence Management**
   - Camera feed integration (Hikvision ColorVu Pro)
   - Manual evidence upload with SHA256 integrity hashing
   - Image/video support

3. **AI Analysis**
   - OpenAI-powered violation detection
   - Confidence scoring
   - Automated explanation generation

4. **UK Parking Violations**
   - Disabled Bay
   - EV Bay
   - Parent & Child Bay
   - Overstay
   - No Permit

5. **ANPR Session Tracking**
   - UK number plate format validation (current, prefix, suffix, dateless)
   - Intelligent entry/exit pairing with 24-hour configurable matching window
   - Session states: OPEN, CLOSED, ORPHAN
   - Orphan detection: DOUBLE_ENTRY (vehicle enters with existing open session), MISSING_ENTRY (exit without matching entry)
   - VRM normalization (uppercase, whitespace removal)
   - Batch event processing with chronological ordering

6. **PCN Generation**
   - Automated PCN number generation
   - AI-generated violation explanations
   - Configurable penalty amounts

7. **Audit Logging**
   - Complete chain of custody
   - All user actions logged

8. **Signage Inspections**
   - Digital signage compliance checks
   - PDF upload with automatic field extraction
   - Photo evidence for each section (entrance, T&C, bay-specific, general)
   - Compliance scoring with appeal risk assessment
   - Status workflow: draft → submitted → approved/rejected
   - Canvas-based signature capture

9. **Context Enrichment**
   - Analyzes parking sessions with external context (weather, local events, site inventory)
   - Provider interfaces for weather and events (mock implementations, can swap for real APIs)
   - Site inventory analysis: aggregates rules, notes, and surroundings
   - Anomaly detection: identifies overstay spikes with intelligent baseline calculation
   - Stores enrichment results in database for historical analysis

10. **Spike Detection & Session Flagging**
    - Historical baseline calculation: 28-day lookback on same weekday/hour band
    - Configurable spike threshold multiplier (default 1.5x baseline)
    - Automatic session flagging when spike detected
    - Flag types: POSSIBLE_DISRUPTION, WEATHER_DISRUPTION, EVENT_DISRUPTION, ROAD_INCIDENT
    - Flag severity levels: low, medium, high, critical
    - Recommendations: HOLD_PCN (suspend enforcement), PROCEED_PCN (continue enforcement), REVIEW_REQUIRED (manual review)
    - Evidence capture: weather conditions, local events, site inventory hits
    - Site-level override policies: hold_on_disruption, always_enforce, review_required
    - Per-site enforcement overrides: enforceOnWeather, enforceOnEvents
    - Flag workflow: OPEN → RESOLVED/DISMISSED

11. **Policy-Based Event Categorization**
    - Event categories: SPORTS_MATCH, CONCERT, FESTIVAL, ROAD_CLOSURE, CONSTRUCTION, EMERGENCY, MARKET, COMMUNITY, OTHER
    - Per-site policy configuration for enforcement vs grace categories
    - Predictable demand events (SPORTS_MATCH) → PROCEED_PCN (enforcement continues)
    - Legitimate disruptions (ROAD_CLOSURE, WEATHER) → HOLD_PCN (suspend enforcement)
    - Decision explanation stored with flags for complete audit trail
    - Configurable weatherPolicy: hold (default), enforce, review
    - Configurable defaultEventPolicy: hold (default), enforce, review

## API Endpoints
- `POST /api/auth/login` - User authentication
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET/POST /api/users` - User management (Admin only)
- `GET/POST /api/cameras` - Camera configuration
- `GET/POST /api/bays` - Parking bay management
- `GET/POST /api/evidence` - Evidence CRUD
- `POST /api/evidence/upload` - File upload
- `GET/POST /api/parking-events` - Parking event management
- `POST /api/parking-events/:id/analyze` - AI analysis
- `POST /api/parking-events/:id/generate-pcn` - PCN generation
- `GET /api/number-plates` - ANPR results
- `POST /api/anpr/events` - Submit ANPR events (single or batch)
- `GET /api/sites/:id/sessions` - Get parking sessions for a site (with pagination/filtering)
- `GET/POST/PATCH/DELETE /api/sites/:id/rules` - Site rules management
- `GET/POST/PATCH/DELETE /api/sites/:id/policy` - Site enforcement policy management (event categories, weather policy)
- `GET/POST /api/sites/:id/notes` - Site notes management
- `PATCH/DELETE /api/notes/:id` - Update/delete individual notes
- `GET/POST/PATCH/DELETE /api/sites/:id/surroundings` - Site surroundings management
- `GET /api/sites/:id/context?at=<ISO_DATE>` - Compiled site context (rules + valid notes + surroundings)
- `GET/PATCH /api/settings/ai` - AI threshold settings
- `GET/POST /api/sites/:id/signage-inspections` - Signage inspections management
- `GET/PATCH/DELETE /api/signage-inspections/:id` - Individual inspection CRUD
- `POST /api/signage-inspections/:id/submit` - Submit inspection for review
- `POST /api/signage-inspections/:id/approve` - Approve inspection (Admin)
- `POST /api/signage-inspections/:id/reject` - Reject inspection (Admin)
- `POST /api/sites/:id/signage-inspections/upload-pdf` - Create inspection from PDF
- `POST /api/signage-inspections/parse-pdf` - Preview PDF extraction
- `POST /api/signage-inspections/:id/photos` - Upload inspection photos
- `DELETE /api/signage-photos/:id` - Delete inspection photo
- `POST /api/sites/:id/enrichment/run` - Run context enrichment analysis (includes automatic flagging)
- `GET /api/sites/:id/enrichment/runs` - Get enrichment run history for a site
- `GET /api/enrichment/runs/:id` - Get specific enrichment run details
- `GET /api/sites/:id/flags` - Get session flags for a site (query params: from, to, status)
- `GET /api/sessions/:id/flags` - Get flags for a specific session
- `GET /api/flags/:id` - Get specific flag details
- `POST /api/flags/:id/resolve` - Resolve a flag (Admin/Operator)
- `POST /api/flags/:id/dismiss` - Dismiss a flag (Admin/Operator)

## Design Guidelines
- Primary Color: Blue (217 91% 35%)
- Font: Inter (UI), JetBrains Mono (code/plates)
- Professional enforcement styling
- Dark/Light theme support
