export type BusinessProfile = {
  id: string;
  name: string;
  website: string;
  phone?: string;
  email?: string;
  address?: string;
  niches: string[];
  services: string[];
  serviceAreas: string[];
  primaryCategory?: string;
  descriptionShort?: string;
  descriptionMedium?: string;
  descriptionLong?: string;
  logoPath?: string;
};

export type OpportunityStatus =
  | "discovered"
  | "queued"
  | "human_action_required"
  | "submitted"
  | "verification_required"
  | "live"
  | "skipped"
  | "failed";

export type Opportunity = {
  id: string;
  url: string;
  domain: string;
  sourceQuery?: string;
  category?: "local_citation" | "industry_directory" | "association" | "partner" | "resource_page" | "sponsorship" | "other";
  relevanceScore?: number;
  spamRisk?: "low" | "medium" | "high";
  submissionUrl?: string;
  status: OpportunityStatus;
};
