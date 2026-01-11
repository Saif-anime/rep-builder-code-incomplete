# Euro Parking Services - AI-Powered Parking Enforcement System

## Overview
This project is an AI-powered parking enforcement system designed for Euro Parking Services. Its primary purpose is to automate and streamline the detection of parking violations, manage Penalty Charge Notices (PCNs), and provide comprehensive tools for enforcement officers. Key capabilities include AI-driven violation detection, Automatic Number Plate Recognition (ANPR), and a robust case management system. The system aims to enhance efficiency, accuracy, and auditability in parking enforcement, leveraging advanced AI models for analysis and decision support.

## User Preferences
I prefer detailed explanations and clear communication. I want the agent to adopt an iterative development approach, making small, testable changes. Please ask for confirmation before making any major architectural changes or significant code refactors. Do not make changes to the `shared/schema.ts` file without explicit instruction.

## System Architecture
The system employs a full-stack architecture consisting of a React frontend, a Python/FastAPI backend, and a PostgreSQL database.

**UI/UX Decisions:**
- **Frontend:** Built with React, Vite, TypeScript, Tailwind CSS, and Shadcn UI for a modern and responsive user experience.
- **Color Scheme:** Primary color is Blue (HSL: 217 91% 35%).
- **Typography:** Uses Inter for UI text and JetBrains Mono for code and number plate displays.
- **Theming:** Supports both dark and light modes.
- **Design Philosophy:** Focuses on professional enforcement styling, providing clear information and intuitive workflows for operators and administrators.
- **Mobile-First Responsive Design:** Full responsive layout using Tailwind breakpoints (sm:, md:, lg:). Key patterns:
  - Stat cards use responsive grid: `grid-cols-2 lg:grid-cols-4`
  - Tables convert to card layouts on mobile via conditional rendering (`hidden sm:block` / `sm:hidden`)
  - Sidebar collapses to sheet on mobile (built-in Shadcn sidebar behavior)
  - Form controls stack vertically on mobile, horizontal on desktop
  - Text sizes scale with breakpoints: `text-xs sm:text-sm md:text-base`
  - Touch-friendly padding and spacing on mobile devices

**Technical Implementations:**
- **Backend:** Python FastAPI with SQLAlchemy ORM for a scalable and maintainable API (migrated from Express.js).
- **Database:** PostgreSQL managed with SQLAlchemy ORM (models defined in `backend/db/models.py`).
- **Authentication:** JWT for secure API access, with bcrypt for password hashing.
- **Role-Based Access Control:** Differentiates between Admin, Operator, and Enforcement Officer roles with specific permissions.
- **Evidence Management:** Supports camera feed integration, manual uploads, and SHA256 hashing for integrity. Handles image and video evidence.
- **ANPR Session Tracking:** Validates UK number plate formats, intelligently pairs entry/exit events within a 24-hour window, and tracks session states (OPEN, CLOSED, ORPHAN). Includes VRM normalization and batch processing.
- **PCN Generation:** Automated PCN numbering and AI-generated violation explanations.
- **Audit Logging:** Comprehensive logging of all user actions for a complete chain of custody.
- **Signage Inspections:** Digital compliance checks via PDF upload (text/OCR) and photo evidence, with compliance scoring and workflow management.
- **Context Enrichment:** Analyzes parking sessions with external data (weather, events, site inventory) to detect anomalies and identify potential disruptions.
- **Spike Detection & Session Flagging:** Calculates historical baselines (28-day lookback) to identify overstay spikes, automatically flagging sessions with severity levels and recommendations (HOLD_PCN, PROCEED_PCN, REVIEW_REQUIRED).
- **Policy-Based Event Categorization:** Configurable policies for handling enforcement during specific event categories (e.g., SPORTS_MATCH, ROAD_CLOSURE).
- **Driver Behaviour Profiling:** Tracks VRM visit statistics, duration analytics, and arrival time patterns to classify driver behavior and assign risk scores.
- **Flagged Sessions Review Dashboard:** Operator UI to review and override AI-generated flags and recommendations, with full audit trails for manual decisions.
- **Enforcement Case Management:** Unified workflow to group evidence into cases, supporting bundle-level AI analysis and timeline reconciliation.
- **DVLA Vehicle Verification:** Automated number plate detection with integration to DVLA API for vehicle data, tax, and MOT status verification, including rate limiting and audit trails.

**Feature Specifications:**
- **AI Analysis:** Utilizes OpenAI GPT-4.1 (via Replit AI) for violation detection, confidence scoring, and automated explanation generation. OpenAI GPT-4o is used for detailed Vision GPT image analysis (vehicle, bay, human, signage detection) with confidence notes.
- **Supported Violations:** Disabled Bay, EV Bay, Parent & Child Bay, Overstay, No Permit, Loading Bay (UK-specific).
- **Loading Bay Analysis:** UK-compliant loading/unloading detection with 8-phase analysis:
  1. Vehicle Type Classification (van, lorry, pickup detection)
  2. Loading Activity Detection (staff, goods, open doors)
  3. Continuity Check (multi-frame activity verification)
  4. Time Reasonableness (UK standards: 20min small goods, 40min large)
  5. Final Decision Logic with confidence scoring
  6. UI Output with activity timeline and badges
  7. Phase 8 Fail-Safe (manual review for <70% confidence)
- **EV Bay Analysis:** UK-compliant Electric Vehicle bay compliance verification:
  1. Evidence Quality Check (full vehicle, charging port, charging unit visibility)
  2. Vehicle EV Capability (BEV/PHEV via DVLA fuel type - authoritative, or visual badging)
  3. Charging Activity Detection (cable connected, port in use, charger connection)
  4. Signage Compliance (max stay, time restrictions, "while charging only" requirements)
  5. Vehicle Position Check (fully inside bay, no overlap)
  6. Decision Logic: COMPLIANT / NON_COMPLIANT / REVIEW_REQUIRED
  7. DVLA data takes priority over Vision GPT for EV verification
  8. Conflicting evidence (Vision sees EV badging but DVLA says petrol) triggers REVIEW_REQUIRED

## External Dependencies
- **AI Integration:** OpenAI (GPT-4.1 for violation analysis, GPT-4o for Vision GPT image analysis).
- **Database:** PostgreSQL.
- **ANPR Cameras:** Hikvision ColorVu Pro (for camera feed integration).
- **OCR:** Tesseract.js (for scanned PDF processing in signage inspections).
- **Vehicle Data:** DVLA API (for vehicle verification and data retrieval).
- **External Context Providers:** Weather and local events APIs (currently uses mock implementations but designed for integration with real APIs).