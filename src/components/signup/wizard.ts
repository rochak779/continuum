import { z } from "zod";

export const STEPS = [
  { title: "Your Organisation", short: "Organization Setup" },
  { title: "Your Details", short: "Your Details" },
  { title: "Invite Team", short: "Invite Team" },
  { title: "Complete", short: "Review & Launch" },
] as const;

export const COUNTRIES = [
  "United States",
  "United Kingdom",
  "India",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "Singapore",
  "United Arab Emirates",
];

export const INDUSTRIES = [
  "Technology",
  "Financial Services",
  "Healthcare",
  "Manufacturing",
  "Retail",
  "Energy & Utilities",
  "Public Sector",
  "Professional Services",
];

export const COMPANY_SIZES = [
  "1-10 Employees",
  "11-50 Employees",
  "50-250 Employees",
  "251-1000 Employees",
  "1000+ Employees",
];

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AUD", "SGD", "AED"];

export const TIME_ZONES = [
  "UTC-08:00 Pacific Time",
  "UTC-05:00 Eastern Time",
  "UTC+00:00 London",
  "UTC+01:00 Central European Time",
  "UTC+04:00 Gulf Standard Time",
  "UTC+05:30 India Standard Time",
  "UTC+08:00 Singapore",
  "UTC+10:00 Sydney",
];

export const DIAL_CODES = [
  { code: "US", dial: "+1" },
  { code: "UK", dial: "+44" },
  { code: "IN", dial: "+91" },
  { code: "AU", dial: "+61" },
  { code: "AE", dial: "+971" },
  { code: "SG", dial: "+65" },
] as const;

export const ROLES = ["Member", "Admin", "Viewer"];

export const DESIGNATIONS = [
  "CTO",
  "CISO",
  "Head of Compliance",
  "Risk Manager",
  "Procurement Lead",
  "Operations Manager",
  "Other",
];

export const organizationSchema = z.object({
  organizationName: z
    .string()
    .trim()
    .min(1, { message: "Enter your organisation name" })
    .max(120),
  country: z.string().min(1, { message: "Select a country" }),
  industry: z.string().min(1, { message: "Select an industry" }),
  companySize: z.string().min(1, { message: "Select a company size" }),
});

export const detailsSchema = z.object({
  fullName: z.string().trim().min(1, { message: "Enter your full name" }).max(100),
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .max(72),
  dialCode: z.string().min(1),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9 ()-]*$/, { message: "Enter a valid phone number" }),
  designation: z.string().min(1, { message: "Select a designation" }),
});

export const inviteSchema = z.object({
  email: z.string().trim().email({ message: "Enter a valid colleague email" }).max(255),
  role: z.string().min(1),
});

export type OrganizationData = z.infer<typeof organizationSchema>;
export type DetailsData = z.infer<typeof detailsSchema>;
export type InviteRow = { id: string; email: string; role: string };

export const emptyOrganization: OrganizationData = {
  organizationName: "",
  country: "",
  industry: "",
  companySize: "",
};

export const emptyDetails: DetailsData = {
  fullName: "",
  email: "",
  password: "",
  dialCode: "+1",
  phone: "",
  designation: "",
};
