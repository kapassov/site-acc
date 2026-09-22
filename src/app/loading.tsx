export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-slate-100" />
      <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col">
            <div className="aspect-[3/4] animate-pulse rounded-xl bg-slate-100" />
            <div className="mt-3 h-3 w-16 animate-pulse rounded bg-slate-100" />
            <div className="mt-2 h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="mt-2 h-5 w-24 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
