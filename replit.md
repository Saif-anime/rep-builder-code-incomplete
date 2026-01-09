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
- `GET/POST /api/sites/:id/notes` - Site notes management
- `PATCH/DELETE /api/notes/:id` - Update/delete individual notes
- `GET/POST/PATCH/DELETE /api/sites/:id/surroundings` - Site surroundings management
- `GET /api/sites/:id/context?at=<ISO_DATE>` - Compiled site context (rules + valid notes + surroundings)
- `GET/PATCH /api/settings/ai` - AI threshold settings

## Design Guidelines
- Primary Color: Blue (217 91% 35%)
- Font: Inter (UI), JetBrains Mono (code/plates)
- Professional enforcement styling
- Dark/Light theme support
