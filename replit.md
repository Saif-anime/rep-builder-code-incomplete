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
   - PDF upload with automatic field extraction (dual-mode: text + OCR fallback)
   - Supports both text-based PDFs and scanned PDFs (via Tesseract.js OCR)
   - Read-only display: PDF is single source of truth
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

12. **Driver Behaviour Profiling**
    - Tracks visit statistics per VRM at each site (30d/90d/total visits)
    - Duration analytics: median, mean, standard deviation calculations
    - Arrival time bucket analysis with percentage distribution and variance detection
    - Behavioural classifications:
      - COMMUTER_PATTERN: Frequent short stays, low variance (≥20 visits/month, ≤20min median, ≤10min stddev)
      - OCCASIONAL_PATRON: Low frequency, moderate duration (≤2 visits/month, 60-180min stays)
      - FIRST_TIME_LATE: First visit with overstay (benefit of doubt)
      - REGULAR_PATRON: Consistent reasonable usage
      - UNKNOWN: Insufficient data for classification
    - Risk scoring system (0-100) with weighted factors:
      - DAILY_SHORT_STAY (40 weight): Daily ~20min patterns
      - CONSISTENT_ARRIVAL (30 weight): Same arrival time variance ≤2h
      - LOW_DURATION_VARIANCE (20 weight): Predictable stay lengths
      - OCCASIONAL_MODERATE_STAY (-30 weight): Fair user indicator
    - Risk flags:
      - POSSIBLE_COMMUTER_MISUSE: High risk score (90) for suspected drop-off abuse
      - LIKELY_FAIR_USER: Low risk for genuine patron behaviour
      - FIRST_VISIT_GRACE: Benefit of doubt for first-time overstays
      - NONE: No specific flag assigned
    - VRM normalization: uppercase + whitespace removal for consistency
    - Nightly batch recomputation with configurable date range filtering

13. **Flagged Sessions Review Dashboard**
    - Operator-facing UI for reviewing AI-generated flags and recommendations
    - Filterable by site, date range, flag type, recommendation type, and status
    - Real-time flag counts and status indicators
    - Detail drawer showing full explanation text and structured evidence JSON
    - Override workflow: operators can override AI recommendations with manual decisions
    - Override actions: HOLD_PCN, PROCEED_PCN, REVIEW_REQUIRED, AUTO_DISMISS
    - All overrides require user-provided reason for audit trail
    - PCN recommendations stored in database with user attribution
    - Recommendation sources: SYSTEM (AI-generated) or USER (manual override)
    - Full audit trail: created_by, reason, evidenceJson, timestamps
    - Philosophy: AI provides recommendations only, humans make final enforcement decisions

14. **Vision GPT Image Analysis**
    - Uses OpenAI GPT-4o for structured, court-ready image analysis
    - Vehicle detection: type, color, VRM visibility, EV indicators
    - Bay type identification: disabled, EV, parent-child, standard
    - Human detection: adult, child presence, disabled badge visibility
    - Signage analysis: visible, readable, compliant indicators
    - Confidence notes for tribunal defense
    - SHA-256 image hashing with in-memory caching to avoid redundant API calls
    - Multi-image analysis with result merging for comprehensive case review

15. **Enforcement Case Management**
    - Unified case workflow: group multiple evidence items into a single case
    - Case-level multi-file upload: upload multiple files directly to a case in one operation
    - Case status workflow: pending → analysing → complete/dismissed
    - Evidence linking: associate camera feeds, manual uploads, PDFs to cases
    - Single-button AI analysis: analyzes all linked evidence simultaneously
    - Timeline reconciliation: first seen, last seen, duration, gap detection
    - Merged vision results: combines findings from multiple images
    - Merged detections tracking: vehicles, persons, bay markings with confidence scores
    - Automated violation detection based on bay type and visible indicators
    - Risk assessment: Low/Medium/High based on confidence scores
    - Recommendations: Issue PCN, Review, No Action
    - Model version tracking and partial failure handling
    - Case-level analysis stored with full audit trail
    - Collapsible evidence list in UI showing all files per case

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
- `GET /api/sites/:id/drivers/:vrm/profile` - Get or calculate driver profile for VRM at site
- `GET /api/sites/:id/drivers` - List all driver profiles for a site
- `POST /api/sites/:id/drivers/recompute` - Batch recompute all driver profiles (query params: from, to)
- `GET /api/parking-sessions/:id` - Get specific parking session by ID
- `GET /api/sessions/:id/recommendations` - Get PCN recommendations for a session
- `POST /api/flags/:id/override` - Override AI recommendation with manual decision
- `POST /api/evidence/:id/vision-analyze` - Analyze evidence image with Vision GPT
- `GET/POST /api/cases` - Enforcement case management
- `GET /api/cases/:id` - Get specific case details
- `POST /api/cases/:id/evidence` - Link evidence to a case
- `GET /api/cases/:id/evidence` - Get all evidence linked to a case
- `POST /api/cases/:id/upload` - Upload multiple files directly to a case
- `POST /api/cases/upload` - Create a new case with uploaded files in one operation
- `POST /api/cases/:id/analyze` - Run unified AI analysis on all case evidence
- `GET /api/cases/:id/analysis` - Get case analysis results

## Design Guidelines
- Primary Color: Blue (217 91% 35%)
- Font: Inter (UI), JetBrains Mono (code/plates)
- Professional enforcement styling
- Dark/Light theme support
