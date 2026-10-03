export type DiscoveryProfile = {
  name: string;
  website: string;
  niches: string[];
  locations: string[];
  services?: string[];
};

const patterns = [
  (term: string) => `"${term}" "submit business"`,
  (term: string) => `"${term}" "add listing"`,
  (term: string) => `"${term}" directory`,
  (term: string) => `"${term}" "business directory"`,
  (term: string) => `"${term}" "submit company"`
];

export function generateDirectoryQueries(profile: DiscoveryProfile) {
  const terms = new Set([
    ...profile.niches,
    ...(profile.services ?? []),
    ...profile.locations.flatMap((location) => profile.niches.map((niche) => `${location} ${niche}`)),
    ...profile.locations.map((location) => `${location} business`)
  ]);

  return [...terms].flatMap((term) => patterns.map((pattern) => pattern(term)));
}
