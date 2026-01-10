import { db } from "../db";
import { sitePolicies, siteRules } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { SitePolicy, InsertSitePolicy } from "@shared/schema";
import type { LocalEvent, EnrichmentResult } from "./contextEnrichment";

export type PolicyDecision = "ENFORCE" | "HOLD" | "REVIEW";

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  recommendation: "PROCEED_PCN" | "HOLD_PCN" | "REVIEW_REQUIRED";
  explanation: string;
  evidenceJson: {
    policyId: number;
    matchedEventCategories: string[];
    weatherPolicy?: string;
    appliedRules: string[];
  };
  confidence: number;
}

export interface EventCategoryConfig {
  category: string;
  displayName: string;
  description: string;
  defaultPolicy: PolicyDecision;
}

export const EVENT_CATEGORIES: EventCategoryConfig[] = [
  { category: "SPORTS_MATCH", displayName: "Sports Match", description: "Football, rugby, or major sporting events", defaultPolicy: "ENFORCE" },
  { category: "LARGE_EVENT", displayName: "Large Event", description: "Concerts, festivals, exhibitions", defaultPolicy: "ENFORCE" },
  { category: "LOCAL_EVENT", displayName: "Local Event", description: "Markets, fairs, community gatherings", defaultPolicy: "REVIEW" },
  { category: "EDUCATION_EVENT", displayName: "Education Event", description: "University open days, graduations", defaultPolicy: "REVIEW" },
  { category: "ROAD_CLOSURE", displayName: "Road Closure", description: "Road works, accidents, diversions", defaultPolicy: "HOLD" },
  { category: "WEATHER", displayName: "Weather", description: "Severe weather conditions", defaultPolicy: "HOLD" },
  { category: "UNKNOWN", displayName: "Unknown", description: "Unclassified events", defaultPolicy: "REVIEW" },
];

export class SiteEventPolicyService {
  async getPolicy(siteId: number): Promise<SitePolicy | null> {
    const [policy] = await db.select().from(sitePolicies)
      .where(eq(sitePolicies.siteId, siteId))
      .limit(1);
    return policy || null;
  }

  async createOrUpdatePolicy(siteId: number, data: Partial<InsertSitePolicy>): Promise<SitePolicy> {
    const existing = await this.getPolicy(siteId);

    if (existing) {
      const [updated] = await db.update(sitePolicies)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(sitePolicies.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(sitePolicies)
      .values({
        siteId,
        eventCategoriesEnforce: data.eventCategoriesEnforce || ["SPORTS_MATCH", "LARGE_EVENT"],
        eventCategoriesGrace: data.eventCategoriesGrace || ["ROAD_CLOSURE", "WEATHER"],
        defaultEventPolicy: data.defaultEventPolicy || "hold",
        weatherPolicy: data.weatherPolicy || "hold",
        isActive: true,
      })
      .returning();

    return created;
  }

  async evaluatePolicy(
    siteId: number,
    enrichmentResult: EnrichmentResult
  ): Promise<PolicyEvaluationResult> {
    const policy = await this.getPolicy(siteId);
    
    if (!policy || !policy.isActive) {
      return this.getDefaultEvaluation(enrichmentResult);
    }

    const matchedCategories: string[] = [];
    const appliedRules: string[] = [];

    if (enrichmentResult.weatherSummary?.alerts && enrichmentResult.weatherSummary.alerts.length > 0) {
      const hasWeatherWarning = enrichmentResult.weatherSummary.alerts.some(
        alert => alert.toLowerCase().includes("warning") || 
                 alert.toLowerCase().includes("hazard")
      );
      
      if (hasWeatherWarning) {
        matchedCategories.push("WEATHER");
        appliedRules.push(`Weather policy: ${policy.weatherPolicy}`);
        
        if (policy.weatherPolicy === "hold") {
          return {
            decision: "HOLD",
            recommendation: "HOLD_PCN",
            explanation: `Weather disruption detected (${enrichmentResult.weatherSummary.conditions}). Policy dictates holding PCN issuance.`,
            evidenceJson: {
              policyId: policy.id,
              matchedEventCategories: matchedCategories,
              weatherPolicy: policy.weatherPolicy,
              appliedRules,
            },
            confidence: 0.85,
          };
        }
      }
    }

    if (enrichmentResult.localEventsSummary?.events) {
      for (const event of enrichmentResult.localEventsSummary.events) {
        matchedCategories.push(event.category);

        if (policy.eventCategoriesGrace?.includes(event.category)) {
          appliedRules.push(`Grace category matched: ${event.category} (${event.name})`);
          
          return {
            decision: "HOLD",
            recommendation: "HOLD_PCN",
            explanation: `Event "${event.name}" (${event.category}) requires grace period. PCN issuance should be held.`,
            evidenceJson: {
              policyId: policy.id,
              matchedEventCategories: matchedCategories,
              appliedRules,
            },
            confidence: 0.80,
          };
        }

        if (policy.eventCategoriesEnforce?.includes(event.category)) {
          appliedRules.push(`Enforce category matched: ${event.category} (${event.name})`);
          
          return {
            decision: "ENFORCE",
            recommendation: "PROCEED_PCN",
            explanation: `Event "${event.name}" (${event.category}) is a known high-demand event. Enforcement should proceed.`,
            evidenceJson: {
              policyId: policy.id,
              matchedEventCategories: matchedCategories,
              appliedRules,
            },
            confidence: 0.90,
          };
        }
      }
    }

    if (matchedCategories.length > 0) {
      appliedRules.push(`Default event policy applied: ${policy.defaultEventPolicy}`);
      
      const decision = policy.defaultEventPolicy === "enforce" ? "ENFORCE" 
        : policy.defaultEventPolicy === "hold" ? "HOLD" 
        : "REVIEW";
      
      return {
        decision,
        recommendation: decision === "ENFORCE" ? "PROCEED_PCN" 
          : decision === "HOLD" ? "HOLD_PCN" 
          : "REVIEW_REQUIRED",
        explanation: `Unclassified events detected. Default policy (${policy.defaultEventPolicy}) applied.`,
        evidenceJson: {
          policyId: policy.id,
          matchedEventCategories: matchedCategories,
          appliedRules,
        },
        confidence: 0.60,
      };
    }

    return {
      decision: "ENFORCE",
      recommendation: "PROCEED_PCN",
      explanation: "No disruptive events or conditions detected. Standard enforcement applies.",
      evidenceJson: {
        policyId: policy.id,
        matchedEventCategories: [],
        appliedRules: ["No matching events - standard enforcement"],
      },
      confidence: 0.95,
    };
  }

  private getDefaultEvaluation(enrichmentResult: EnrichmentResult): PolicyEvaluationResult {
    if (enrichmentResult.weatherSummary?.alerts?.length) {
      return {
        decision: "HOLD",
        recommendation: "HOLD_PCN",
        explanation: "Weather alerts detected. Default policy: hold PCN pending review.",
        evidenceJson: {
          policyId: 0,
          matchedEventCategories: ["WEATHER"],
          weatherPolicy: "hold",
          appliedRules: ["Default weather hold policy"],
        },
        confidence: 0.70,
      };
    }

    const hasRoadClosure = enrichmentResult.localEventsSummary?.events.some(
      e => e.category === "ROAD_CLOSURE"
    );
    
    if (hasRoadClosure) {
      return {
        decision: "HOLD",
        recommendation: "HOLD_PCN",
        explanation: "Road closure detected. Default policy: hold PCN pending review.",
        evidenceJson: {
          policyId: 0,
          matchedEventCategories: ["ROAD_CLOSURE"],
          appliedRules: ["Default road closure hold policy"],
        },
        confidence: 0.75,
      };
    }

    return {
      decision: "REVIEW",
      recommendation: "REVIEW_REQUIRED",
      explanation: "No policy configured for this site. Manual review required.",
      evidenceJson: {
        policyId: 0,
        matchedEventCategories: [],
        appliedRules: ["No site policy - default to review"],
      },
      confidence: 0.50,
    };
  }

  getEventCategories(): EventCategoryConfig[] {
    return EVENT_CATEGORIES;
  }
}

export const siteEventPolicyService = new SiteEventPolicyService();
