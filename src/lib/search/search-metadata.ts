/** Public metadata contains no infrastructure details or provider credentials. */
export type ProductSearchMetadata = {
  query: string;
  matchedQuery: string | null;
  matchType: "exact" | "typo" | "layout" | "transliteration" | "alias" | "none";
  degraded: boolean;
};

export type ProductSearchEngine = "typesense" | "daribar";
