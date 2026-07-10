// Niche categories (from the agency's standard list) + date-range presets.
export const NICHES: string[] = [
  "Agriculture & Farming", "Animals & Pets", "Arts & Photography", "Automobiles & Cars",
  "Banking & Finance", "Beauty", "Blockchain and Cryptocurrency", "Books & Literature",
  "Business", "Casino (Gambling)", "Computers & Electronics", "Construction & Repairs",
  "Crafts and DIY", "Culture & Society", "Digital Marketing & Advertising", "E-commerce",
  "Education", "Energy", "Entertainment", "Environment & Nature", "Fashion",
  "Food & Beverages", "For Men", "For Women", "Gadgets & Technology", "Gaming",
  "Gardening and Lawn Care", "General", "Graphics & Design", "Health (Fitness)",
  "Home Improvement", "Industrial Equipment & Machinery", "Insurance",
  "Internet & Telecommunication", "Jobs & Employment", "Kids & Children", "Legal",
  "Leisure and Hobbies", "Lifestyle", "Magazines & Newspapers", "Manufacturing & Industry",
  "Music & Instruments", "News & Media", "Others (Miscellaneous)", "Outdoors",
  "Parenting & Mommy", "Personal Development", "Pharmacy", "Politics", "Real Estate",
  "Review Sites", "SaaS", "Science", "Services", "Shopping", "Social Media", "Sports",
  "Tourism & Travel", "Transport & Logistic", "Websites & Software Development", "Wedding",
];

export interface DatePreset { label: string; days: number; } // days: 0 = Latest (no date filter)
export const DATE_PRESETS: DatePreset[] = [
  { label: "Latest", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 3 months", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "Last year", days: 365 },
];
