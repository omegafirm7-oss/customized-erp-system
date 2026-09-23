export const BUSINESS_LINES = [
  { id: "training", label: "Safety Training & TUV Cards" },
  { id: "contracting", label: "Contracting" },
  { id: "subcontracting", label: "Villa / Building Sub-contracting" },
  { id: "manpower", label: "Manpower Supply" },
  { id: "machinery", label: "Machinery Rental" },
  { id: "materials", label: "Material Supply" },
];

export const SAFETY_CERTS = [
  "TUV Safety Card",
  "NEBOSH Certificate",
  "OSHA 30-Hour",
  "IOSH Managing Safely",
  "First Aid / CPR",
  "H2S Alive",
  "Confined Space Entry",
  "Working at Heights",
  "Fire Warden",
  "Scaffolding Safety",
  "Rigging & Lifting",
  "Excavation Safety",
];

export const TARGET_TYPES = [
  "SME contractors (Grade 3-5)",
  "Main contractors (villa / residential)",
  "Industrial contractors (Aramco / SABIC vendors)",
  "Developers (ROSHN / NHC / Sakani)",
  "EPC / infrastructure firms",
  "Manpower agencies",
];

export const CITIES = [
  "Dammam", "Khobar", "Jubail", "Dhahran", "Al Ahsa", "Qatif", "Ras Tanura",
  "Hafar Al-Batin", "Riyadh", "Jeddah", "NEOM", "All Eastern Province", "All KSA",
];

export const CONTRACTOR_GRADES = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Unclassified"];

export const PRIORITIES = [
  { id: "HOT", label: "Hot" },
  { id: "WARM", label: "Warm" },
  { id: "COLD", label: "Cold" },
];

export const TUV_PROFILE_TEMPLATE = (companyName: string) =>
  `${companyName} is a TVTC-approved and authorized training partner based in the Eastern Province, Saudi Arabia.

Services:
- Safety training and certification: TUV safety cards (new and renewal), NEBOSH, H2S, confined space, working at heights, first aid, scaffolding, rigging & lifting, fire warden.
- Also: manpower supply, machinery rental, villa/building sub-contracting, project material supply.

Why clients choose us: TVTC-accredited certificates accepted on Aramco, SABIC, Royal Commission and ROSHN sites; group batches for contractor crews; on-site training available.

Training centre: [city / address]
Batch schedule: [e.g. new batch every week, Sunday-Tuesday]
Pricing we can quote: [e.g. TUV card from SAR ___ per person, group discounts for 10+]
Contact / WhatsApp: [+966 ...]`;

export interface AgentStatus {
  aiConfigured: boolean;
  emailConfigured: boolean;
}
