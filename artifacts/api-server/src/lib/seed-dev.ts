import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { providersTable, servicesTable } from "@workspace/db";

const categories = [
  ["plumbing", "Plumbing", "home"],
  ["electrical", "Electrical", "home"],
  ["appliance-repair", "Appliance repair", "home"],
  ["cleaning", "Cleaning", "home"],
  ["hvac", "Heating and cooling", "home"],
  ["locksmith", "Locksmith", "home"],
  ["pest-control", "Pest control", "home"],
  ["landscaping", "Landscaping", "home"],
  ["handyman", "Handyman", "home"],
  ["mechanic", "Mechanic", "automotive"],
  ["mobile-mechanic", "Mobile mechanic", "automotive"],
  ["towing", "Towing", "automotive"],
  ["tire-services", "Tire services", "automotive"],
  ["vehicle-detailing", "Vehicle detailing", "automotive"],
  ["battery-assistance", "Battery assistance", "automotive"],
  ["auto-electrician", "Auto electrician", "automotive"],
  ["beauty", "Beauty services", "personal"],
  ["barber", "Barber", "personal"],
  ["photography", "Photography", "personal"],
  ["tutoring", "Tutoring", "personal"],
  ["fitness", "Fitness coaching", "personal"],
  ["pet-services", "Pet services", "personal"],
  ["it-support", "IT support", "business"],
  ["web-development", "Web development", "business"],
  ["graphic-design", "Graphic design", "business"],
  ["accounting", "Accounting", "business"],
  ["marketing", "Marketing", "business"],
  ["office-maintenance", "Office maintenance", "business"],
  ["commercial-cleaning", "Commercial cleaning", "business"],
  ["videography", "Videography", "events"],
  ["dj", "DJ services", "events"],
  ["catering", "Catering", "events"],
  ["event-decorating", "Event decorating", "events"],
  ["event-equipment", "Event equipment", "events"],
  ["building", "Building and construction", "construction"],
  ["painting", "Painting", "construction"],
  ["roofing", "Roofing", "construction"],
  ["tiling", "Tiling", "construction"],
  ["welding", "Welding", "construction"],
  ["carpentry", "Carpentry", "construction"],
] as const;

export async function seedDevelopmentData(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Synthetic seed data is disabled in production.");
  }

  await db.insert(servicesTable).values(
    categories.map(([slug, name, category]) => ({ slug, name, category })),
  ).onConflictDoNothing();

  const [existingDemo] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.isDemo, true))
    .limit(1);
  if (existingDemo) return;

  await db.insert(providersTable).values([
    {
      companyName: "Demo Plumbing Company",
      description: "Synthetic development record. This is not a real business.",
      serviceSlugs: ["plumbing"],
      city: "Nairobi",
      countryCode: "KE",
      currency: "KES",
      isDemo: true,
    },
    {
      companyName: "Demo Home Electrical",
      description: "Synthetic development record. This is not a real business.",
      serviceSlugs: ["electrical", "handyman"],
      city: "Manchester",
      countryCode: "GB",
      currency: "GBP",
      isDemo: true,
    },
    {
      companyName: "Demo Appliance Care",
      description: "Synthetic development record. This is not a real business.",
      serviceSlugs: ["appliance-repair"],
      city: "New York",
      countryCode: "US",
      currency: "USD",
      isDemo: true,
    },
  ]).onConflictDoNothing();
}