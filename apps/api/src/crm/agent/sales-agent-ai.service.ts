import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { AppConfig } from "../../core/config/configuration";

export interface ResearchedLead {
  companyName: string;
  activity: string;
  location: string;
  phone: string;
  email: string;
  website: string;
  whyTheyNeedUs: string;
  howToReach: string;
  confidence: string;
  notes: string;
}

export interface ResearchParams {
  service: string;
  targetType: string;
  city: string;
  extraCriteria?: string;
  excludeCompanies?: string[];
}

export interface DraftParams {
  channel: "WHATSAPP" | "EMAIL";
  purpose: "INTRO" | "FOLLOW_UP";
  language: "en" | "ar" | "both";
  companyName: string;
  companyProfile: string;
  senderName: string;
  lead: {
    name: string;
    companyName: string | null;
    city: string | null;
    projectName: string | null;
    businessLines: string[];
    safetyCertsRequired: string[];
    aiRationale: string | null;
    notes: string | null;
  };
  previousMessages: { channel: string; sentAt: Date | null; body: string }[];
  extraInstructions?: string;
}

const LEADS_PER_RUN = 5;

// Fallbacks re-run a request that the primary model declines on another
// model inside the same call, so a sales-copy request never dead-ends on a
// classifier false positive.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Email subject line. Empty string for WhatsApp." },
    body: { type: "string", description: "The message body, ready to send." },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

/**
 * Server-side Claude calls for the CRM sales agent. The browser never talks
 * to Anthropic directly — the API key lives only in the server env, and
 * every call is scoped to the requesting company's own profile/leads.
 */
@Injectable()
export class SalesAgentAiService {
  private readonly logger = new Logger(SalesAgentAiService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const ai = configService.get("ai", { infer: true });
    this.client = ai.anthropicApiKey ? new Anthropic({ apiKey: ai.anthropicApiKey }) : null;
    this.model = ai.model;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Live web research for real companies matching the search — nothing is saved here. */
  async researchLeads(companyProfile: string, params: ResearchParams): Promise<ResearchedLead[]> {
    const client = this.requireClient();
    const exclude = (params.excludeCompanies ?? []).filter(Boolean);

    const prompt = `You are a B2B lead researcher working for the company described here:
<company_profile>
${companyProfile}
</company_profile>

Use web search to find up to ${LEADS_PER_RUN} real, currently operating companies that match:
- Company type: ${params.targetType}
- Location: ${params.city}, Saudi Arabia
- What we want to sell them: ${params.service}
${params.extraCriteria ? `- Extra criteria: ${params.extraCriteria}\n` : ""}${exclude.length ? `- Do NOT include these companies, which we already have: ${exclude.join(", ")}\n` : ""}
For safety training / TUV card leads, prioritise contractors working on Saudi Aramco, SABIC, Royal Commission (Jubail/Yanbu), ROSHN, NEOM or other giga-project sites — their workers must hold valid safety cards to get site access, so they need card training and renewals continuously.

Rules:
- Never invent contact details. If a phone number or email is not published on the company's official site or a recent directory, use "not listed".
- Prefer companies with visible 2025-2026 activity.
- confidence: HIGH = official website or recent news, MED = business directories, LOW = older or indirect sources.

When you are done researching, reply with ONLY a JSON object, no markdown fences and no commentary, keeping each field under 30 words:
{"leads":[{"companyName":"","activity":"what they do and active projects","location":"","phone":"","email":"","website":"","whyTheyNeedUs":"","howToReach":"best route to the decision maker","confidence":"HIGH","notes":""}]}`;

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
    let text = "";
    // Web search is a server tool: a long research turn can come back as
    // pause_turn, which is continued by re-sending the assistant content.
    for (let round = 0; round < 4; round++) {
      const response = await this.call(() =>
        client.beta.messages
          .stream({
            model: this.model,
            max_tokens: 32000,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            tools: [
              {
                type: "web_search_20260209",
                name: "web_search",
                max_uses: 8,
                user_location: { type: "approximate", country: "SA", timezone: "Asia/Riyadh" },
              },
            ],
            messages,
          })
          .finalMessage(),
      );
      this.assertNotRefused(response);
      text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }

    const leads = parseLeadsRobust(text)
      .map(normalizeLead)
      .filter((l) => l.companyName && !exclude.some((e) => e.toLowerCase() === l.companyName.toLowerCase()));
    if (leads.length === 0) {
      throw new BadGatewayException("The agent found no usable leads for this search — try a different city or broader criteria");
    }
    return leads;
  }

  /** Drafts one outreach message for a lead; the user reviews/edits before anything is sent. */
  async draftMessage(params: DraftParams): Promise<{ subject: string; body: string }> {
    const client = this.requireClient();
    const { lead } = params;

    const languageRule =
      params.language === "ar"
        ? "Write in Arabic (Modern Standard, polite business tone)."
        : params.language === "both"
          ? "Write the message in English first, then the same message in Arabic below it."
          : "Write in English.";
    const channelRule =
      params.channel === "WHATSAPP"
        ? "This is a WhatsApp message: keep it under 90 words, conversational but professional, short paragraphs, at most one or two emojis, no subject line (return an empty subject), and end with one clear call to action (e.g. reply to book a batch / get a quote)."
        : "This is an email: give a specific subject line (under 9 words) and a body of 120-180 words with a greeting, why this matters to them, what we offer, and one clear call to action. Do NOT add a signature block — it is appended automatically.";
    const purposeRule =
      params.purpose === "FOLLOW_UP"
        ? "This is a FOLLOW-UP to the earlier message(s) below that got no reply yet. Do not repeat the first message; add one new angle (e.g. upcoming batch dates, card expiry/renewal risk blocking site access, group discount) and keep it shorter than the original."
        : "This is the FIRST contact with this lead.";

    const history = params.previousMessages.length
      ? params.previousMessages
          .map((m) => `[${m.channel}${m.sentAt ? `, sent ${m.sentAt.toISOString().slice(0, 10)}` : ""}]\n${m.body}`)
          .join("\n\n")
      : "(none)";

    const prompt = `You write sales outreach for ${params.companyName}, signed by ${params.senderName}.

<company_profile>
${params.companyProfile}
</company_profile>

<lead>
Contact name: ${lead.name}
Company: ${lead.companyName ?? "unknown"}
City: ${lead.city ?? "unknown"}
Project: ${lead.projectName ?? "unknown"}
Services of interest: ${lead.businessLines.join(", ") || "safety training / TUV cards"}
Safety certifications they need: ${lead.safetyCertsRequired.join(", ") || "not specified"}
Research notes on why they need us: ${lead.aiRationale ?? "none"}
Internal notes: ${lead.notes ?? "none"}
</lead>

<previous_messages>
${history}
</previous_messages>

${purposeRule}
${channelRule}
${languageRule}

Focus the pitch on the services of interest above (TUV safety cards and safety training unless the lead says otherwise). Only state facts about our company that appear in the company profile — never invent prices, dates, accreditations or phone numbers. If the contact name looks like a company rather than a person, use a neutral greeting.${params.extraInstructions ? `\n\nAdditional instructions from the salesperson: ${params.extraInstructions}` : ""}`;

    const response = await this.call(() =>
      client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 8000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
          messages: [{ role: "user", content: prompt }],
        })
        .finalMessage(),
    );
    this.assertNotRefused(response);
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      const parsed = JSON.parse(text) as { subject?: string; body?: string };
      if (!parsed.body) throw new Error("empty body");
      return { subject: params.channel === "EMAIL" ? (parsed.subject ?? "") : "", body: parsed.body.trim() };
    } catch {
      throw new BadGatewayException("The AI returned an unreadable draft — please try again");
    }
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new ServiceUnavailableException("The AI sales agent is not configured on the server (ANTHROPIC_API_KEY missing)");
    }
    return this.client;
  }

  private assertNotRefused(response: Anthropic.Beta.BetaMessage) {
    if (response.stop_reason === "refusal") {
      throw new BadGatewayException("The AI declined this request — try rewording the criteria or instructions");
    }
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        this.logger.error("Anthropic API key rejected");
        throw new ServiceUnavailableException("The AI sales agent's API key was rejected — check ANTHROPIC_API_KEY on the server");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ServiceUnavailableException("The AI service is busy (rate limited) — please retry in a minute");
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Anthropic API error ${err.status}: ${err.message}`);
        throw new BadGatewayException(`AI service error (${err.status ?? "network"}) — please retry`);
      }
      throw err;
    }
  }
}

/**
 * Parses the research agent's JSON reply, salvaging every complete lead
 * object even when the reply is wrapped in prose or cut off mid-array.
 */
export function parseLeadsRobust(text: string): unknown[] {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const match = clean.match(/\{[\s\S]*\}/);
    const full = JSON.parse(match ? match[0] : clean);
    if (Array.isArray(full?.leads)) return full.leads;
  } catch {
    // fall through to salvage mode
  }
  const arrStart = clean.indexOf("[");
  if (arrStart === -1) return [];
  const body = clean.slice(arrStart + 1);
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          objects.push(JSON.parse(body.slice(start, i + 1)));
        } catch {
          // skip a broken object
        }
        start = -1;
      }
    }
  }
  return objects;
}

function normalizeLead(raw: unknown): ResearchedLead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const conf = str(r.confidence).toUpperCase();
  return {
    companyName: str(r.companyName),
    activity: str(r.activity),
    location: str(r.location),
    phone: str(r.phone),
    email: str(r.email),
    website: str(r.website),
    whyTheyNeedUs: str(r.whyTheyNeedUs),
    howToReach: str(r.howToReach),
    confidence: conf.startsWith("H") ? "HIGH" : conf.startsWith("M") ? "MED" : "LOW",
    notes: str(r.notes),
  };
}
