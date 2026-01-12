from sqlalchemy import Column, Integer, String, Text, Boolean, Float, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid

from backend.db.session import Base

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    username = Column(Text, nullable=False, unique=True)
    password = Column(Text, nullable=False)
    email = Column(Text, nullable=False)
    full_name = Column(Text, nullable=False)
    role = Column(Text, nullable=False, default="operator")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_login = Column(DateTime)

class Camera(Base):
    __tablename__ = "cameras"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    location = Column(Text, nullable=False)
    ip_address = Column(Text, nullable=False)
    username = Column(Text, nullable=False)
    password = Column(Text, nullable=False)
    rtsp_url = Column(Text)
    isapi_url = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    status = Column(Text, nullable=False, default="offline")
    status_message = Column(Text)
    site_id = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_snapshot = Column(DateTime)
    last_checked_at = Column(DateTime)
    last_online_at = Column(DateTime)

class Bay(Base):
    __tablename__ = "bays"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    type = Column(Text, nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    location = Column(Text)
    rules = Column(JSONB)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class ParkingSite(Base):
    __tablename__ = "parking_sites"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_name = Column(Text, nullable=False)
    location_code = Column(Text)
    address_line_1 = Column(Text)
    address_line_2 = Column(Text)
    address_line_3 = Column(Text)
    address_line_4 = Column(Text)
    city = Column(Text)
    postcode = Column(Text)
    regulations = Column(Text)
    enforcer = Column(Text)
    total_bays = Column(Integer, default=0)
    disabled_bays = Column(Integer, default=0)
    ev_bays = Column(Integer, default=0)
    parent_child_bays = Column(Integer, default=0)
    ai_instructions = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Site(Base):
    __tablename__ = "sites"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    address = Column(Text, nullable=False)
    postcode = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Evidence(Base):
    __tablename__ = "evidence"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    type = Column(Text, nullable=False)
    bundle_id = Column(Integer)
    site_id = Column(Integer, ForeignKey("parking_sites.id"))
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    bay_id = Column(Integer, ForeignKey("bays.id"))
    uploaded_by = Column(String, ForeignKey("users.id"))
    image_path = Column(Text)
    video_path = Column(Text)
    thumbnail_path = Column(Text)
    timestamp = Column(DateTime, nullable=False)
    sha256_hash = Column(Text)
    file_metadata = Column("metadata", JSONB)
    notes = Column(Text)
    status = Column(Text, nullable=False, default="pending")
    reviewed_by = Column(String, ForeignKey("users.id"))
    reviewed_at = Column(DateTime)
    analysis_started_at = Column(DateTime)
    analysis_completed_at = Column(DateTime)
    ai_result = Column(JSONB)
    confidence_score = Column(Float)
    analysis_error = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class EnforcementCase(Base):
    __tablename__ = "enforcement_cases"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    site_id = Column(Integer, ForeignKey("parking_sites.id"))
    vrm = Column(Text)
    bay_type = Column(Text)
    status = Column(Text, nullable=False, default="NEW")
    evidence_count = Column(Integer, nullable=False, default=0)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class CaseEvidence(Base):
    __tablename__ = "case_evidence"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    evidence_id = Column(Integer, ForeignKey("evidence.id"), nullable=False)
    source = Column(Text, nullable=False, default="manual")
    key_finding = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class CaseAnalysis(Base):
    __tablename__ = "case_analysis"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False, unique=True)
    summary = Column(Text)
    vehicle_details = Column(JSONB)
    bay_type = Column(Text)
    signage_findings = Column(JSONB)
    human_detection = Column(JSONB)
    violations = Column(JSONB)
    confidence_score = Column(Float)
    risk_assessment = Column(Text)
    recommendation = Column(Text)
    timeline_summary = Column(Text)
    time_window = Column(JSONB)
    merged_detections = Column(JSONB)
    model_versions = Column(JSONB)
    supporting_evidence_ids = Column(JSONB)
    partial_failures = Column(JSONB)
    generated_at = Column(DateTime, server_default=func.now(), nullable=False)

class CaseVehicle(Base):
    __tablename__ = "case_vehicles"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    registration_number = Column(Text, nullable=False)
    make = Column(Text)
    model = Column(Text)
    colour = Column(Text)
    fuel_type = Column(Text)
    tax_status = Column(Text)
    tax_due_date = Column(Text)
    mot_status = Column(Text)
    mot_expiry_date = Column(Text)
    engine_capacity = Column(Integer)
    co2_emissions = Column(Integer)
    year_of_manufacture = Column(Integer)
    first_registration_date = Column(Text)
    wheelplan = Column(Text)
    revenue_weight = Column(Integer)
    euro_status = Column(Text)
    marked_for_export = Column(Boolean)
    confidence_score = Column(Float, nullable=False)
    source_evidence_ids = Column(JSONB)
    source_bundle_ids = Column(JSONB)
    detection_method = Column(Text, nullable=False, default="vision_gpt")
    plate_readings = Column(JSONB)
    conflict_detected = Column(Boolean, nullable=False, default=False)
    conflict_details = Column(Text)
    dvla_verified = Column(Boolean, nullable=False, default=False)
    dvla_lookup_error = Column(Text)
    verified_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class CaseAnalysisStep(Base):
    __tablename__ = "case_analysis_steps"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    step_name = Column(Text, nullable=False)
    step_order = Column(Integer, nullable=False)
    status = Column(Text, nullable=False, default="pending")
    input_data = Column(JSONB)
    output_data = Column(JSONB)
    error_message = Column(Text)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)
    duration_ms = Column(Integer)
    model_version = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Pcn(Base):
    __tablename__ = "pcns"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    pcn_number = Column(Text, nullable=False, unique=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    vrm = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="draft")
    eligibility = Column(Text, nullable=False)
    regulation_breached = Column(Text)
    breach_details = Column(JSONB)
    signage_compliant = Column(Boolean, nullable=False, default=False)
    signage_confirmation = Column(JSONB)
    analysis_snapshot = Column(JSONB)
    amount = Column(Float, nullable=False)
    explanation = Column(Text)
    evidence_references = Column(JSONB)
    issued_by = Column(String, ForeignKey("users.id"))
    issued_at = Column(DateTime)
    generated_by = Column(Text, nullable=False, default="system")
    override_reason = Column(Text)
    override_by = Column(String, ForeignKey("users.id"))
    override_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class CasePipelineResults(Base):
    __tablename__ = "case_pipeline_results"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False, unique=True)
    pipeline_status = Column(Text, nullable=False, default="pending")
    current_step = Column(Text)
    completed_steps = Column(Integer, nullable=False, default=0)
    total_steps = Column(Integer, nullable=False, default=9)
    evidence_timeline = Column(JSONB)
    vision_results = Column(JSONB)
    dvla_data = Column(JSONB)
    regulation_evaluation = Column(JSONB)
    signage_compliance = Column(JSONB)
    context_enrichment = Column(JSONB)
    behaviour_profiling = Column(JSONB)
    bay_rule_evaluation = Column(JSONB)
    decision = Column(JSONB)
    analysis_started_at = Column(DateTime)
    analysis_completed_at = Column(DateTime)
    analysis_error = Column(Text)
    triggered_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class EvidenceBundle(Base):
    __tablename__ = "evidence_bundles"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    name = Column(Text)
    status = Column(Text, nullable=False, default="pending")
    file_count = Column(Integer, nullable=False, default=0)
    ai_result = Column(JSONB)
    analysis_started_at = Column(DateTime)
    analysis_completed_at = Column(DateTime)
    analysis_error = Column(Text)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Detection(Base):
    __tablename__ = "detections"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    evidence_id = Column(Integer, ForeignKey("evidence.id"), nullable=False)
    object_type = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False)
    bounding_box = Column(JSONB)
    attributes = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class ParkingEvent(Base):
    __tablename__ = "parking_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    evidence_id = Column(Integer, ForeignKey("evidence.id"), nullable=False)
    bay_id = Column(Integer, ForeignKey("bays.id"))
    number_plate_id = Column(Integer, ForeignKey("number_plates.id"))
    violation_type = Column(Text)
    is_violation = Column(Boolean, nullable=False, default=False)
    ai_confidence = Column(Float)
    ai_explanation = Column(Text)
    ai_reasoning = Column(JSONB)
    status = Column(Text, nullable=False, default="pending")
    pcn_number = Column(Text)
    pcn_issued_at = Column(DateTime)
    pcn_amount = Column(Float)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class NumberPlate(Base):
    __tablename__ = "number_plates"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    evidence_id = Column(Integer, ForeignKey("evidence.id"), nullable=False)
    plate_text = Column(Text, nullable=False)
    plate_image = Column(Text)
    confidence = Column(Float, nullable=False)
    is_valid_uk_format = Column(Boolean, nullable=False, default=False)
    bounding_box = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id"))
    action = Column(Text, nullable=False)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(Text)
    details = Column(JSONB)
    ip_address = Column(Text)
    user_agent = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class SiteRule(Base):
    __tablename__ = "site_rules"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    max_stay_minutes = Column(Integer)
    grace_entry_minutes = Column(Integer, default=5)
    grace_exit_minutes = Column(Integer, default=5)
    enforcement_mode = Column(Text, nullable=False, default="standard")
    allowlists = Column(JSONB)
    denylists = Column(JSONB)
    spike_override_policy = Column(Text, default="hold_on_disruption")
    enforce_on_weather = Column(Boolean, default=False)
    enforce_on_events = Column(Boolean, default=False)
    spike_threshold_multiplier = Column(Float, default=1.5)
    baseline_window_days = Column(Integer, default=28)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SitePolicy(Base):
    __tablename__ = "site_policies"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False, unique=True)
    event_categories_enforce = Column(ARRAY(Text), default=[])
    event_categories_grace = Column(ARRAY(Text), default=[])
    default_event_policy = Column(Text, nullable=False, default="hold")
    weather_policy = Column(Text, nullable=False, default="hold")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SiteNote(Base):
    __tablename__ = "site_notes"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    note_type = Column(Text, nullable=False, default="general")
    content = Column(Text, nullable=False)
    tags = Column(ARRAY(Text))
    valid_from = Column(DateTime, server_default=func.now(), nullable=False)
    valid_to = Column(DateTime)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SiteSurroundings(Base):
    __tablename__ = "site_surroundings"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False, unique=True)
    nearby_places = Column(JSONB)
    free_text_summary = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class AiSetting(Base):
    __tablename__ = "ai_settings"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    setting_key = Column(Text, nullable=False, unique=True)
    setting_value = Column(JSONB)
    description = Column(Text)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    role = Column(Text, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class AnprEvent(Base):
    __tablename__ = "anpr_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    vrm = Column(Text, nullable=False)
    event_type = Column(Text, nullable=False)
    occurred_at = Column(DateTime, nullable=False)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    raw_payload = Column(JSONB)
    confidence = Column(Float)
    source = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class ParkingSession(Base):
    __tablename__ = "parking_sessions"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    vrm = Column(Text, nullable=False)
    entry_event_id = Column(Integer, ForeignKey("anpr_events.id"))
    exit_event_id = Column(Integer, ForeignKey("anpr_events.id"))
    entry_at = Column(DateTime)
    exit_at = Column(DateTime)
    duration_minutes = Column(Integer)
    status = Column(Text, nullable=False, default="OPEN")
    derived_from = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SignageInspection(Base):
    __tablename__ = "signage_inspections"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    inspection_date = Column(DateTime, nullable=False)
    inspector_id = Column(String, ForeignKey("users.id"), nullable=False)
    inspector_name = Column(Text, nullable=False)
    site_code = Column(Text)
    site_address = Column(Text)
    status = Column(Text, nullable=False, default="draft")
    entrance_signage_present = Column(Boolean)
    entrance_clearly_visible = Column(Boolean)
    entrance_correct_wording = Column(Boolean)
    entrance_height_compliant = Column(Boolean)
    entrance_lighting_day = Column(Boolean)
    entrance_lighting_night = Column(Boolean)
    entrance_condition = Column(Text)
    tc_tariff_visible = Column(Boolean)
    tc_font_readable = Column(Boolean)
    tc_distance_readable = Column(Float)
    tc_language_correct = Column(Boolean)
    tc_lighting_present = Column(Boolean)
    disabled_sign_present = Column(Boolean)
    disabled_markings_visible = Column(Boolean)
    disabled_upright_sign = Column(Boolean)
    disabled_wording_correct = Column(Boolean)
    ev_sign_present = Column(Boolean)
    ev_markings_visible = Column(Boolean)
    ev_upright_sign = Column(Boolean)
    ev_wording_correct = Column(Boolean)
    parent_child_sign_present = Column(Boolean)
    parent_child_markings_visible = Column(Boolean)
    parent_child_upright_sign = Column(Boolean)
    parent_child_wording_correct = Column(Boolean)
    bpa_ipc_compliant = Column(Boolean)
    conflicting_signage_present = Column(Boolean)
    obstructions_present = Column(Boolean)
    weather_damage = Column(Boolean)
    graffiti_present = Column(Boolean)
    general_notes = Column(Text)
    signature_data = Column(Text)
    declaration_timestamp = Column(DateTime)
    overall_compliance_score = Column(Float)
    entrance_score = Column(Float)
    tc_score = Column(Float)
    bay_signage_score = Column(Float)
    general_score = Column(Float)
    appeal_risk_score = Column(Float)
    night_visibility_risk = Column(Float)
    ai_analysis = Column(JSONB)
    submitted_at = Column(DateTime)
    approved_by = Column(String, ForeignKey("users.id"))
    approved_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SignagePhoto(Base):
    __tablename__ = "signage_photos"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    inspection_id = Column(Integer, ForeignKey("signage_inspections.id", ondelete="CASCADE"), nullable=False)
    section = Column(Text, nullable=False)
    photo_path = Column(Text, nullable=False)
    thumbnail_path = Column(Text)
    caption = Column(Text)
    sha256_hash = Column(Text)
    uploaded_by = Column(String, ForeignKey("users.id"))
    photo_metadata = Column("metadata", JSONB)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class EnrichmentRun(Base):
    __tablename__ = "enrichment_runs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    window_start = Column(DateTime, nullable=False)
    window_end = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    created_by = Column(String, ForeignKey("users.id"))
    status = Column(Text, nullable=False, default="completed")
    results = Column(JSONB)
    error_message = Column(Text)

class SessionFlag(Base):
    __tablename__ = "session_flags"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("parking_sessions.id"), nullable=False)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    enrichment_run_id = Column(Integer, ForeignKey("enrichment_runs.id"))
    flag_type = Column(Text, nullable=False)
    severity = Column(Text, nullable=False, default="medium")
    reason = Column(Text, nullable=False)
    recommendation = Column(Text)
    evidence = Column(JSONB)
    status = Column(Text, nullable=False, default="OPEN")
    resolved_at = Column(DateTime)
    resolved_by = Column(String, ForeignKey("users.id"))
    resolution_notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class DriverProfile(Base):
    __tablename__ = "driver_profiles"
    __table_args__ = (
        UniqueConstraint('site_id', 'vrm', name='driver_profiles_site_vrm_unique'),
    )
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    vrm = Column(String(20), nullable=False)
    first_seen = Column(DateTime, nullable=False)
    last_seen = Column(DateTime, nullable=False)
    visits_30d = Column(Integer, nullable=False, default=0)
    visits_90d = Column(Integer, nullable=False, default=0)
    total_visits = Column(Integer, nullable=False, default=0)
    median_duration_minutes = Column(Float)
    mean_duration_minutes = Column(Float)
    duration_stddev = Column(Float)
    common_arrival_time_buckets = Column(JSONB)
    behaviour_classification = Column(Text, default="UNKNOWN")
    risk_flag = Column(Text, default="NONE")
    risk_score = Column(Float, nullable=False, default=0)
    risk_factors = Column(JSONB)
    last_calculated_at = Column(DateTime, server_default=func.now(), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class PcnRecommendation(Base):
    __tablename__ = "pcn_recommendations"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("parking_sessions.id"), nullable=False)
    flag_id = Column(Integer, ForeignKey("session_flags.id"))
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    vrm = Column(String(20), nullable=False)
    action = Column(Text, nullable=False)
    previous_action = Column(Text)
    source = Column(Text, nullable=False, default="SYSTEM")
    created_by = Column(String, ForeignKey("users.id"))
    reason = Column(Text, nullable=False)
    reason_plain = Column(Text, nullable=False)
    evidence_json = Column(JSONB)
    confidence = Column(Float, nullable=False, default=0.5)
    is_override = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class ParkingSiteSignage(Base):
    __tablename__ = "parking_site_signage"
    
    id = Column(String, primary_key=True, default=generate_uuid)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    signage_type = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    source = Column(Text, nullable=False, default="IMAGE")
    extracted_data = Column(JSONB)
    confidence_score = Column(Float, default=0)
    effective_from = Column(DateTime, server_default=func.now(), nullable=False)
    effective_to = Column(DateTime)
    status = Column(Text, nullable=False, default="ACTIVE")
    display_priority = Column(Integer, default=0)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)

class SignageRuleFile(Base):
    __tablename__ = "signage_rule_files"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    signage_id = Column(String, ForeignKey("parking_site_signage.id", ondelete="CASCADE"), nullable=False)
    file_path = Column(Text, nullable=False)
    file_type = Column(Text, nullable=False)
    mime_type = Column(Text)
    sha256_hash = Column(Text)
    page_number = Column(Integer)
    extracted_text = Column(Text)
    ai_analysis = Column(JSONB)
    uploaded_by = Column(String, ForeignKey("users.id"))
    uploaded_at = Column(DateTime, server_default=func.now(), nullable=False)

class SignageUsageAudit(Base):
    __tablename__ = "signage_usage_audit"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(String, ForeignKey("enforcement_cases.id"), nullable=False)
    signage_id = Column(String, ForeignKey("parking_site_signage.id"), nullable=False)
    rules_applied = Column(JSONB)
    confidence_at_usage = Column(Float)
    explanation_generated = Column(Text)
    used_at = Column(DateTime, server_default=func.now(), nullable=False)


class SiteIntelligenceBay(Base):
    """Detailed bay information for site intelligence."""
    __tablename__ = "site_intelligence_bays"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    bay_identifier = Column(Text, nullable=False)
    bay_type = Column(Text, nullable=False)
    zone = Column(Text)
    signage_clarity_score = Column(Integer, default=3)
    marking_condition_score = Column(Integer, default=3)
    common_misuse_patterns = Column(JSONB)
    notes = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)


class SiteBehaviorPattern(Base):
    """Motorist behavior patterns observed at a site."""
    __tablename__ = "site_behavior_patterns"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    pattern_type = Column(Text, nullable=False)
    description = Column(Text, nullable=False)
    peak_times = Column(JSONB)
    affected_bays = Column(JSONB)
    frequency = Column(Text)
    severity = Column(Text, default="MEDIUM")
    notes = Column(Text)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, ForeignKey("users.id"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), nullable=False)


class AnprScan(Base):
    """ANPR scan results from folder processing."""
    __tablename__ = "anpr_scans"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    folder_path = Column(Text, nullable=False)
    image_filename = Column(Text, nullable=False)
    image_path = Column(Text, nullable=False)
    vrm = Column(Text)
    vrm_confidence = Column(Float)
    timestamp_extracted = Column(DateTime)
    timestamp_confidence = Column(Float)
    dvla_make = Column(Text)
    dvla_model = Column(Text)
    dvla_colour = Column(Text)
    dvla_fuel_type = Column(Text)
    dvla_tax_status = Column(Text)
    dvla_mot_status = Column(Text)
    dvla_year = Column(Integer)
    dvla_verified = Column(Boolean, nullable=False, default=False)
    dvla_error = Column(Text)
    dvla_raw_data = Column(JSONB)
    status = Column(Text, nullable=False, default="pending")
    error_message = Column(Text)
    processed_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class SiteIntelligenceAttachment(Base):
    """Attachments for site intelligence (photos, maps, videos)."""
    __tablename__ = "site_intelligence_attachments"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    bay_id = Column(Integer, ForeignKey("site_intelligence_bays.id"))
    attachment_type = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text)
    file_path = Column(Text, nullable=False)
    file_type = Column(Text)
    mime_type = Column(Text)
    file_size = Column(Integer)
    sha256_hash = Column(Text)
    ai_analysis = Column(JSONB)
    uploaded_by = Column(String, ForeignKey("users.id"))
    uploaded_at = Column(DateTime, server_default=func.now(), nullable=False)


class WeatherObservation(Base):
    """Cached weather observations for evidence timestamp enrichment."""
    __tablename__ = "weather_observations"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False)
    observation_time = Column(DateTime, nullable=False)
    latitude = Column(Float)
    longitude = Column(Float)
    source = Column(Text, nullable=False, default="open_meteo")
    
    # Weather data
    temperature_c = Column(Float)
    feels_like_c = Column(Float)
    humidity_percent = Column(Integer)
    precipitation_mm = Column(Float)
    rain_mm = Column(Float)
    cloud_cover_percent = Column(Integer)
    visibility_m = Column(Integer)
    wind_speed_kmh = Column(Float)
    wind_direction_deg = Column(Integer)
    weather_code = Column(Integer)
    weather_description = Column(Text)
    is_day = Column(Boolean)
    
    # Raw API response for audit
    raw_data = Column(JSONB)
    
    # Metadata
    retrieved_at = Column(DateTime, server_default=func.now(), nullable=False)
    
    __table_args__ = (
        UniqueConstraint('site_id', 'observation_time', 'source', name='uq_weather_site_time_source'),
        Index('ix_weather_site_time', 'site_id', 'observation_time'),
    )


class SiteGeolocation(Base):
    """Cached geocoding results for parking sites (postcode to lat/long)."""
    __tablename__ = "site_geolocations"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    site_id = Column(Integer, ForeignKey("parking_sites.id"), nullable=False, unique=True)
    postcode = Column(Text)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    source = Column(Text, nullable=False, default="postcodes_io")
    raw_data = Column(JSONB)
    retrieved_at = Column(DateTime, server_default=func.now(), nullable=False)
