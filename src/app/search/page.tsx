import { Suspense } from "react";
import { SearchResults } from "@/components/search/SearchResults";

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-10 sm:px-6" />}>
      <SearchResults />
    </Suspense>
  );
}
